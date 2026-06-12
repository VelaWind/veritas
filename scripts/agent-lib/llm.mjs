// ─────────────────────────────────────────────────────────────────────────────
// LlmProvider — the one seam between an agent and a model (DECISIONS §B.7).
//
// A single interface:  complete(messages, opts) -> { text, usage }
//   usage = { input_tokens, output_tokens, total_tokens }
//
// The adapter is chosen ENTIRELY by environment, so switching cloud↔local is
// config-only, never a code change:
//
//   VERITAS_LLM_PROVIDER   openai-compatible (DEFAULT) | anthropic | openai
//   VERITAS_LLM_BASE_URL   default http://localhost:11434/v1  (local Ollama)
//   VERITAS_LLM_MODEL      default qwen2.5:14b  (per-provider fallback otherwise)
//   VERITAS_LLM_API_KEY    server-side only; never NEXT_PUBLIC_*
//
// ZERO PER-CALL COST BY DEFAULT: the default provider is `openai-compatible`
// pointed at a LOCAL Ollama, which has no marginal API cost and needs no key
// (a dummy key is sent so the OpenAI-style header is well-formed). The cloud
// adapters (anthropic / openai) exist and are first-class, but are reachable
// ONLY by explicitly setting VERITAS_LLM_PROVIDER — nothing can bill unless you
// change that env var. A cloud provider selected without an API key throws,
// rather than silently doing anything.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MODELS = {
  "openai-compatible": "qwen2.5:14b",
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
};

const DEFAULT_BASE_URLS = {
  "openai-compatible": "http://localhost:11434/v1",
  openai: "https://api.openai.com/v1",
};

const CLOUD_PROVIDERS = new Set(["anthropic", "openai"]);

function envNum(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve provider config from env (+ optional overrides) and return a provider
 * with a single `complete()` method. Pure fetch — no vendor SDK — so neither the
 * install footprint nor the build is touched by an off-by-default cloud path.
 */
export function createLlmProvider(overrides = {}) {
  const provider = overrides.provider ?? process.env.VERITAS_LLM_PROVIDER ?? "openai-compatible";
  if (!(provider in DEFAULT_MODELS)) {
    throw new Error(
      `Unknown VERITAS_LLM_PROVIDER "${provider}" (expected openai-compatible | anthropic | openai).`,
    );
  }

  const model = overrides.model ?? process.env.VERITAS_LLM_MODEL ?? DEFAULT_MODELS[provider];
  const baseUrl =
    overrides.baseUrl ?? process.env.VERITAS_LLM_BASE_URL ?? DEFAULT_BASE_URLS[provider];
  const apiKey = overrides.apiKey ?? process.env.VERITAS_LLM_API_KEY ?? "";
  const temperature = overrides.temperature ?? Number(process.env.VERITAS_LLM_TEMPERATURE ?? "0.4");
  const maxTokens = overrides.maxTokens ?? envNum("VERITAS_LLM_MAX_TOKENS", 1500);
  const timeoutMs = overrides.timeoutMs ?? envNum("VERITAS_LLM_TIMEOUT_MS", 180_000);

  // Cloud is opt-in and must never be reachable by accident.
  if (CLOUD_PROVIDERS.has(provider) && !apiKey) {
    throw new Error(
      `VERITAS_LLM_PROVIDER=${provider} is a CLOUD provider and requires VERITAS_LLM_API_KEY. ` +
        `Leave the provider unset (or set openai-compatible) to use the zero-cost local model.`,
    );
  }

  const isZeroCost = provider === "openai-compatible";
  const adapter =
    provider === "anthropic" ? anthropicComplete : openAiStyleComplete;

  return {
    provider,
    model,
    baseUrl: provider === "anthropic" ? "https://api.anthropic.com" : baseUrl,
    isZeroCost,
    describe() {
      return `${provider} · ${model}${isZeroCost ? ` · ${baseUrl} (local, $0/call)` : ""}`;
    },
    /**
     * @param {{role:string, content:string}[]} messages
     * @param {{maxTokens?:number, temperature?:number, system?:string}} [opts]
     * @returns {Promise<{text:string, usage:{input_tokens:number,output_tokens:number,total_tokens:number}}>}
     */
    async complete(messages, opts = {}) {
      const cfg = {
        model,
        baseUrl: provider === "anthropic" ? "https://api.anthropic.com" : baseUrl,
        apiKey: apiKey || (isZeroCost ? "ollama" : ""),
        temperature: opts.temperature ?? temperature,
        maxTokens: opts.maxTokens ?? maxTokens,
        timeoutMs,
        system: opts.system,
      };
      return withRetry(() => adapter(messages, cfg));
    },
  };
}

async function withRetry(fn, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Only retry transient transport errors, not HTTP 4xx/5xx (those carry a
      // .status we surface immediately so the runner can stop on, e.g., 401).
      if (err && typeof err.status === "number") throw err;
    }
  }
  throw lastErr;
}

async function fetchJson(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  const bodyText = await res.text();
  if (!res.ok) {
    const err = new Error(`LLM HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error(`LLM returned non-JSON: ${bodyText.slice(0, 200)}`);
  }
}

// ── OpenAI-style /chat/completions (covers openai-compatible → Ollama, vLLM,
//    LM Studio … and the OpenAI cloud) ─────────────────────────────────────────
async function openAiStyleComplete(messages, cfg) {
  const merged = cfg.system
    ? [{ role: "system", content: cfg.system }, ...messages]
    : messages;
  const json = await fetchJson(
    `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey || "ollama"}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: merged,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
        stream: false,
      }),
    },
    cfg.timeoutMs,
  );
  const text = json.choices?.[0]?.message?.content ?? "";
  const u = json.usage ?? {};
  return {
    text,
    usage: {
      input_tokens: u.prompt_tokens ?? 0,
      output_tokens: u.completion_tokens ?? 0,
      total_tokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
    },
  };
}

// ── Anthropic Messages API (native REST; no SDK dependency) ──────────────────
async function anthropicComplete(messages, cfg) {
  const json = await fetchJson(
    `${cfg.baseUrl.replace(/\/$/, "")}/v1/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        ...(cfg.system ? { system: cfg.system } : {}),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    },
    cfg.timeoutMs,
  );
  const text = Array.isArray(json.content)
    ? json.content.filter((b) => b.type === "text").map((b) => b.text).join("")
    : "";
  const u = json.usage ?? {};
  return {
    text,
    usage: {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
    },
  };
}
