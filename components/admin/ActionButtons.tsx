"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/client-api";

export function ScanContradictionsButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setMessage(null);
    const res = await api.post<{ inserted: number }>("/api/contradictions/scan");
    setPending(false);
    if (res.error) {
      setMessage(res.error);
      return;
    }
    setMessage(
      res.data?.inserted
        ? `${res.data.inserted} new contradiction(s) detected.`
        : "No new contradictions found.",
    );
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-3">
      <Button onClick={run} disabled={pending}>
        {pending ? "Scanning…" : "Run contradiction scan"}
      </Button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </span>
  );
}

export function RefreshStatsButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setMessage(null);
    const res = await api.post("/api/stats");
    setPending(false);
    setMessage(res.error ?? "Dashboard stats refreshed.");
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-3">
      <Button onClick={run} disabled={pending}>
        {pending ? "Refreshing…" : "Refresh dashboard stats"}
      </Button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </span>
  );
}

export function RetireHypothesisButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retire() {
    if (!window.confirm("Retire this hypothesis? It stays in history (soft delete).")) {
      return;
    }
    setPending(true);
    const res = await api.delete(`/api/hypotheses/${id}`);
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-3">
      <Button variant="danger" onClick={retire} disabled={pending}>
        {pending ? "Retiring…" : "Retire hypothesis"}
      </Button>
      {error && (
        <span className="text-xs" style={{ color: "var(--contradiction)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
