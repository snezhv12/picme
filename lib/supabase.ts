import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type Player = { id: string; name: string };

export type Round = {
  id: string;
  prompt: string;
  category: string | null;
  status: "collecting" | "revealing" | "done";
  // When uploads close, in server time
  ends_at: string | null;
};

export type Photo = {
  id: string;
  round_id: string;
  player_id: string;
  path: string;
  revealed: boolean;
  // Slideshow order (1, 2, 3, ...), set when uploads close
  position: number | null;
};

// One shared phase drives the projector and every phone
export type Phase = "lobby" | "uploading" | "voting" | "reveal" | "scoreboard";

export type GameState = {
  phase: Phase;
  current_round_id: string | null;
  current_photo_id: string | null;
  vote_count: number;
};

export type Score = { player_id: string; name: string; points: number };

export const ROUND_COLS = "id,prompt,category,status,ends_at";
export const PHOTO_COLS = "id,round_id,player_id,path,revealed,position";
export const GAME_STATE_COLS = "phase,current_round_id,current_photo_id,vote_count";

export function photoUrl(path: string) {
  return supabase.storage.from("photos").getPublicUrl(path).data.publicUrl;
}

// Ranks with ties: 10, 7, 7, 3 -> 1, 2, 2, 4
export function rankOf(scores: Score[], i: number) {
  return scores.findIndex((s) => s.points === scores[i].points) + 1;
}
