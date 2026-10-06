"use server";

import { headers } from "next/headers";
import { clearHostCookie, hostPin, isHost, pinMatches, setHostCookie } from "@/lib/hostAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type UnlockResult = { ok: true } | { ok: false; error: string; waitSeconds?: number };

// Who's trying (per IP), so wrong guesses slow down that device
async function attemptKey() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  return `ip:${ip}`;
}

export async function unlock(pin: string): Promise<UnlockResult> {
  const db = supabaseAdmin();
  if (!hostPin() || !db) {
    return { ok: false, error: "The host PIN isn't set up on the server yet." };
  }
  const key = await attemptKey();

  const { data: wait } = await db.rpc("host_lock_seconds", { p_key: key });
  if (wait && wait > 0) {
    return { ok: false, error: "Too many wrong tries.", waitSeconds: wait };
  }

  const ok = pinMatches(String(pin ?? ""));
  const { data: after } = await db.rpc("host_record_attempt", { p_key: key, p_ok: ok });
  if (!ok) {
    return after && after > 0
      ? { ok: false, error: "Too many wrong tries.", waitSeconds: after }
      : { ok: false, error: "That's not the PIN." };
  }

  await setHostCookie();
  return { ok: true };
}

export async function lock() {
  await clearHostCookie();
}

// Every host move, checked against the PIN cookie, then run with the
// server-only key. The database refuses these from browsers.
const HOST_RPCS = {
  host_set_preview: ["p_prompt", "p_category", "p_from"],
  host_start_round: [],
  host_remove_player: ["p_id"],
  set_timer: ["p_seconds"],
  set_pick_mode: ["p_mode"],
  skip_picker: [],
  add_time: ["p_seconds"],
  end_uploads: [],
  close_voting: ["p_photo"],
  next_photo: ["p_current"],
  back_to_lobby: [],
  end_game: [],
  play_again: [],
  new_game: [],
  approve_player: ["p_id"],
  decline_player: ["p_id"],
  set_auto_approve: ["p_on"],
  host_approve_claim: ["p_claim"],
  host_decline_claim: ["p_claim"],
} as const;

export type HostRpc = keyof typeof HOST_RPCS;
export type HostResult = { ok: true } | { ok: false; error: string; locked?: boolean };

export async function hostAction(
  name: HostRpc,
  args: Record<string, unknown> = {}
): Promise<HostResult> {
  if (!(await isHost())) return { ok: false, error: "Locked", locked: true };
  if (!Object.hasOwn(HOST_RPCS, name)) return { ok: false, error: "Unknown action" };
  const db = supabaseAdmin();
  if (!db) return { ok: false, error: "Server isn't set up" };

  // Only pass the parameters this function takes
  const params = Object.fromEntries(HOST_RPCS[name].map((k) => [k, args[k] ?? null]));
  const { error } = await db.rpc(name, params);
  return error ? { ok: false, error: error.message } : { ok: true };
}
