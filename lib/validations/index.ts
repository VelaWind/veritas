import { z } from "zod";
import { isConsistent } from "@/lib/knowledge-engine/taxonomy";

/**
 * Zod schemas shared by admin forms and API routes (§6). The DB remains the
 * authority on epistemics — these mirrors exist for fast, friendly errors.
 */

export const epistemicStatusSchema = z.enum([
  "established",
  "strong_evidence",
  "plausible",
  "speculation",
  "unknown",
]);

export const hypothesisStateSchema = z.enum([
  "draft",
  "active",
  "contested",
  "superseded",
  "retired",
]);

export const evidenceRelationSchema = z.enum(["supports", "opposes", "neutral"]);

export const sourceTypeSchema = z.enum([
  "peer_reviewed",
  "preprint",
  "book",
  "dataset",
  "experiment",
  "observation",
  "simulation_result",
  "philosophical_argument",
  "mathematical_proof",
  "other",
]);

export const simulationCategorySchema = z.enum([
  "artificial_ecosystems",
  "agent_intelligence",
  "civilizations",
  "universe_simulations",
  "consciousness_experiments",
]);

export const simulationStatusSchema = z.enum([
  "planned",
  "running",
  "completed",
  "archived",
]);

const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and hyphens");

const pct = z.coerce.number().int().min(0).max(100);

export const assumptionSchema = z.object({
  text: z.string().min(1),
  justified: z.boolean(),
  notes: z.string().optional(),
});

export const openQuestionItemSchema = z.object({ text: z.string().min(1) });

// ── Hypotheses ──────────────────────────────────────────────────────────────

const hypothesisBase = z.object({
  slug: slugSchema,
  domain_id: z.string().uuid(),
  question_id: z.string().uuid().nullable().optional(),
  title: z.string().min(3).max(300),
  description: z.string().min(1),
  status: epistemicStatusSchema,
  state: hypothesisStateSchema,
  confidence: pct,
  confidence_rationale: z.string(),
  assumptions: z.array(assumptionSchema).default([]),
  open_questions: z.array(openQuestionItemSchema).default([]),
  falsification_criteria: z.string().default(""),
});

function checkEpistemics(
  data: { status?: z.infer<typeof epistemicStatusSchema>; confidence?: number },
  ctx: z.RefinementCtx,
) {
  if (data.status !== undefined && data.confidence !== undefined) {
    if (!isConsistent(data.status, data.confidence)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confidence"],
        message: `Confidence ${data.confidence} is outside the permitted band for status "${data.status}" (DB constraint epistemics_consistent).`,
      });
    }
  }
}

function checkActiveRationale(
  data: { state?: z.infer<typeof hypothesisStateSchema>; confidence_rationale?: string },
  ctx: z.RefinementCtx,
) {
  if (data.state === "active" && data.confidence_rationale !== undefined) {
    if (data.confidence_rationale.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confidence_rationale"],
        message: "Active hypotheses require a confidence rationale.",
      });
    }
  }
}

export const hypothesisCreateSchema = hypothesisBase
  .superRefine(checkEpistemics)
  .superRefine(checkActiveRationale);

export const hypothesisUpdateSchema = hypothesisBase
  .partial()
  .superRefine(checkEpistemics)
  .superRefine(checkActiveRationale);

export const confidenceUpdateSchema = z.object({
  value: pct,
  rationale: z.string().trim().min(1, "A rationale is mandatory for confidence changes."),
});

export const evidenceLinkSchema = z.object({
  evidenceId: z.string().uuid(),
  relation: evidenceRelationSchema,
  weight: pct.default(50),
  notes: z.string().default(""),
});

export const evidenceUnlinkSchema = z.object({
  evidenceId: z.string().uuid(),
});

// ── Evidence & sources ──────────────────────────────────────────────────────

export const sourceCreateSchema = z.object({
  title: z.string().min(1).max(400),
  authors: z.string().max(600).nullable().optional(),
  url: z.string().url().nullable().optional().or(z.literal("").transform(() => null)),
  doi: z.string().max(120).nullable().optional(),
  source_type: sourceTypeSchema.default("other"),
  year: z.coerce.number().int().min(-3000).max(2200).nullable().optional(),
  reliability: pct.default(50),
});

const evidenceBase = z.object({
  slug: slugSchema,
  title: z.string().min(3).max(300),
  summary: z.string().min(1),
  strength: pct.default(50),
  domain_id: z.string().uuid().nullable().optional(),
  source_id: z.string().uuid().nullable().optional(),
  /** Provide instead of source_id to create the source inline. */
  new_source: sourceCreateSchema.nullable().optional(),
});

export const evidenceCreateSchema = evidenceBase;
export const evidenceUpdateSchema = evidenceBase.partial();

// ── Questions ───────────────────────────────────────────────────────────────

const questionBase = z.object({
  slug: slugSchema,
  domain_id: z.string().uuid(),
  title: z.string().min(3).max(300),
  description: z.string().default(""),
  importance: pct.default(50),
  status: epistemicStatusSchema.default("unknown"),
  current_explanations: z.string().default(""),
  research_progress: z.string().default(""),
});

export const questionCreateSchema = questionBase;
export const questionUpdateSchema = questionBase.partial();

// ── Domains ─────────────────────────────────────────────────────────────────

const domainBase = z.object({
  slug: slugSchema,
  name: z.string().min(2).max(120),
  overview: z.string().default(""),
  icon: z.string().max(60).nullable().optional(),
  sort_order: z.coerce.number().int().min(0).max(1000).default(0),
  research_status: z.string().default(""),
});

export const domainCreateSchema = domainBase;
export const domainUpdateSchema = domainBase.partial();

// ── Simulations ─────────────────────────────────────────────────────────────

const jsonRecord = z.record(z.unknown());

const simulationBase = z.object({
  slug: slugSchema,
  category: simulationCategorySchema,
  title: z.string().min(3).max(300),
  description: z.string().default(""),
  parameters: jsonRecord.default({}),
  status: simulationStatusSchema.default("planned"),
});

export const simulationCreateSchema = simulationBase;
export const simulationUpdateSchema = simulationBase.partial();

export const simulationRunCreateSchema = z.object({
  parameters: jsonRecord.default({}),
  results: jsonRecord.default({}),
  metrics: jsonRecord.default({}),
  artifact_path: z.string().nullable().optional(),
  started_at: z.string().datetime({ offset: true }).nullable().optional(),
  finished_at: z.string().datetime({ offset: true }).nullable().optional(),
});

// ── Research notes ──────────────────────────────────────────────────────────

const noteBase = z.object({
  slug: slugSchema,
  title: z.string().min(3).max(300),
  body: z.string().min(1),
  published: z.boolean().default(false),
});

export const noteCreateSchema = noteBase;
export const noteUpdateSchema = noteBase.partial();

// ── Contradictions ──────────────────────────────────────────────────────────

export const contradictionResolveSchema = z
  .object({
    resolved: z.boolean(),
    resolution_notes: z.string().default(""),
  })
  .superRefine((data, ctx) => {
    if (data.resolved && data.resolution_notes.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolution_notes"],
        message: "Resolving a contradiction requires resolution notes.",
      });
    }
  });

// ── Suggestion queue (Post-1.0 Phase A) ─────────────────────────────────────

export const suggestionTargetSchema = z.enum(["hypothesis", "evidence"]);
export const suggestionOperationSchema = z.enum(["create", "edit"]);

/**
 * The payload of a suggestion is validated against the SAME create/edit schema
 * the admin forms use — one shared contract, so an approved suggestion produces
 * exactly the record a direct admin write would. The DB constraints remain the
 * final authority (the apply_suggestion() function re-checks them).
 */
export const SUGGESTION_PAYLOAD_SCHEMAS = {
  hypothesis: { create: hypothesisCreateSchema, edit: hypothesisUpdateSchema },
  evidence: { create: evidenceCreateSchema, edit: evidenceUpdateSchema },
} as const;

/** Envelope only — the payload is re-validated per (target_type, operation). */
export const suggestionEnvelopeSchema = z
  .object({
    target_type: suggestionTargetSchema,
    operation: suggestionOperationSchema,
    target_id: z.string().uuid().nullable().optional(),
    payload: z.record(z.unknown()),
    rationale: z.string().trim().max(2000).default(""),
  })
  .superRefine((data, ctx) => {
    if (data.operation === "edit" && !data.target_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target_id"],
        message: "An edit suggestion must name the record it edits (target_id).",
      });
    }
  });

export const suggestionReviewSchema = z.object({
  notes: z.string().trim().max(2000).default(""),
});

export const suggestionRejectSchema = z.object({
  notes: z
    .string()
    .trim()
    .min(1, "A rejection needs a short reason for the proposer.")
    .max(2000),
});

// ── Misc ────────────────────────────────────────────────────────────────────

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const revalidateSchema = z.object({
  tags: z.array(z.string().min(1).max(64)).max(20).default([]),
  paths: z.array(z.string().min(1).max(200)).max(20).default([]),
});
