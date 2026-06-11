"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (authError) {
      setError(authError.message);
      setPending(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-content justify-center px-4 py-24 sm:px-6">
      <div className="card w-full max-w-md p-8">
        <p className="eyebrow">Restricted instrument</p>
        <h1 className="mt-2 font-display text-xl font-light text-ink">
          Admin sign in
        </h1>
        <p className="mt-2 text-sm text-muted">
          Public signup is disabled (§4.2). Accounts are provisioned manually
          by an existing administrator.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="eyebrow block pb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-edge bg-void px-3 py-2 text-sm text-ink placeholder:text-muted"
            />
          </div>
          <div>
            <label htmlFor="password" className="eyebrow block pb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-edge bg-void px-3 py-2 text-sm text-ink"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm" style={{ color: "var(--contradiction)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded bg-accent px-4 py-2 text-sm font-medium text-void transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
