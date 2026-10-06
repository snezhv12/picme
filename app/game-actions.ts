"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SHUFFLE, pickPrompt } from "@/lib/prompts";

// Any open phone or the host calls this when a countdown runs out. The
// database only moves the game on if the deadline really has passed, so
// calling it early or many times at once is harmless. The Shuffle prompt is
// drawn here on the server (prompts live in the app, not the database).
export async function tick(): Promise<string> {
  const db = supabaseAdmin();
  if (!db) return "server not set up";

  const { data: g } = await db
    .from("game_state")
    .select("phase,deadline,preview_prompt")
    .eq("id", 1)
    .single();
  if (!g) return "no game";

  let prompt: string | null = null;
  let category: string | null = null;
  if (g.phase === "lobby" && !g.preview_prompt) {
    const { data: rs } = await db.from("rounds").select("prompt");
    const pick = pickPrompt(SHUFFLE, (rs ?? []).map((r) => r.prompt));
    prompt = pick?.prompt ?? null;
    category = pick?.category ?? null;
  }

  const { data, error } = await db.rpc("game_tick", { p_prompt: prompt, p_category: category });
  return error ? `error: ${error.message}` : String(data);
}
