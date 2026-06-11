import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * Cookie-less anon client for public RSC reads. Using this (instead of the
 * cookie-bound server client) keeps SSG/ISR pages static — calling cookies()
 * would force them dynamic and defeat the §1.3 rendering strategy.
 * It sees exactly what an anonymous visitor sees under RLS.
 */
export const publicClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
