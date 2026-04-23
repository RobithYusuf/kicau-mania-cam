import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { state, MAX_SUBMIT_SCORE, NAME_PATTERN } from "../state";
import type { LeaderEntry } from "../types";

let supa: SupabaseClient | null = null;
let lastSubmitAt = 0;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export function initSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return supa;
}

export function isSupabaseConfigured(): boolean { return supa !== null; }

let userIP: string | null = null;
export async function detectIP(): Promise<string | null> {
  try {
    const r = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    const j = await r.json() as { ip?: string };
    userIP = typeof j.ip === "string" ? j.ip : null;
    return userIP;
  } catch {
    return null;
  }
}
export function getIP(): string | null { return userIP; }

interface SubmitResult { status: string; current_score: number; }

export async function submitGlobalScore(
  name: string,
  score: number,
  force = false,
): Promise<SubmitResult | { skipped: string } | null> {
  if (!supa) return null;
  const now = Date.now();
  // Throttle bisa di-bypass dengan force=true (untuk final submit di STOP/auto-stop)
  if (!force && now - lastSubmitAt < 3000) return { skipped: "throttle" };
  if (typeof score !== "number" || score < 0 || score > MAX_SUBMIT_SCORE) return { skipped: "score-range" };
  const cleanName = String(name || "").trim().slice(0, 20);
  if (!NAME_PATTERN.test(cleanName)) return { skipped: "name-invalid" };
  lastSubmitAt = now;
  const ip = userIP || "anon";
  try {
    const { data, error } = await supa.rpc("submit_score", { p_ip: ip, p_name: cleanName, p_score: score });
    if (error) throw error;
    if (state.debug) console.log(`[SUPA] submit ${force ? "FORCED" : ""}:`, data);
    return data as SubmitResult;
  } catch (e) {
    console.warn("[SUPA] submit failed:", (e as Error).message || e);
    return null;
  }
}

export interface GlobalLeaderboard {
  rows: LeaderEntry[];
  total: number;
  topScore: number;
}

export async function fetchGlobal(limit = 50): Promise<GlobalLeaderboard | null> {
  if (!supa) return null;
  try {
    const { data, error, count } = await supa
      .from("leaderboard")
      .select("name, score, updated_at", { count: "exact" })
      .order("score", { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows = (data || []) as LeaderEntry[];
    return {
      rows,
      total: count || rows.length,
      topScore: rows[0]?.score || 0,
    };
  } catch (e) {
    console.warn("[SUPA] fetch failed:", (e as Error).message || e);
    return null;
  }
}

export function subscribeGlobal(onChange: () => void): void {
  if (!supa) return;
  supa
    .channel("leaderboard-realtime")
    .on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "leaderboard" },
      () => onChange(),
    )
    .subscribe();
}
