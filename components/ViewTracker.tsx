"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Fires the anon-callable increment_popularity RPC once per mount. Kept on the
 * client so the ISR-cached server page stays side-effect-free.
 */
export function ViewTracker({ hypothesisId }: { hypothesisId: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const supabase = createClient();
    supabase.rpc("increment_popularity", { h_id: hypothesisId }).then(
      () => {},
      () => {},
    );
  }, [hypothesisId]);
  return null;
}
