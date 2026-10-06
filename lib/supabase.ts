import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Only approved players take part; the host lets pending players in
export type PlayerStatus = "pending" | "approved" | "declined";
export type Player = {
  id: string;
  name: string;
  status: PlayerStatus;
  // The phone this player is on; another phone holding the same player is signed out
  device_id: string | null;
};

export const PLAYER_COLS = "id,name,status,device_id";

// "Continue as Alessandra": waits for the host like a new player does
export type Claim = {
  id: string;
  player_id: string;
  status: PlayerStatus;
  created_at: string;
};
export const CLAIM_COLS = "id,player_id,status,created_at";

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
  // Live reaction counts, e.g. { "😂": 3 } (who reacted stays hidden until the reveal)
  reactions: Record<string, number>;
  // The uploader's story; stays null for everyone until the photo is revealed
  story: string | null;
  // Has the uploader been revealed yet?
  answer_revealed: boolean;
};

// One shared phase drives the projector and every phone
export type Phase = "lobby" | "uploading" | "voting" | "reveal" | "scoreboard";

export type GameState = {
  phase: Phase;
  current_round_id: string | null;
  current_photo_id: string | null;
  vote_count: number;
  // Lobby: who picks the category, whose turn it is, and the prompt on show
  pick_mode: "host" | "players";
  picker_id: string | null;
  preview_prompt: string | null;
  preview_category: string | null;
  // What the preview was drawn from (category id or "shuffle"); null = host's own
  preview_from: string | null;
  // Upload time for the next round; null = no timer
  timer_seconds: number | null;
  // Let everyone in without the host approving each player
  auto_approve: boolean;
  // When the current step moves on by itself (picking, voting, reveal)
  deadline: string | null;
};

export type Score = { player_id: string; name: string; points: number };

export const ROUND_COLS = "id,prompt,category,status,ends_at";
export const PHOTO_COLS =
  "id,round_id,player_id,path,revealed,position,reactions,story,answer_revealed";
export const GAME_STATE_COLS =
  "phase,current_round_id,current_photo_id,vote_count,pick_mode,picker_id,preview_prompt,preview_category,preview_from,timer_seconds,auto_approve,deadline";

export function photoUrl(path: string) {
  return supabase.storage.from("photos").getPublicUrl(path).data.publicUrl;
}

// Ranks with ties: 10, 7, 7, 3 -> 1, 2, 2, 4
export function rankOf(scores: Score[], i: number) {
  return scores.findIndex((s) => s.points === scores[i].points) + 1;
}
