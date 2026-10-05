import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type Player = { id: string; name: string };

export type Round = {
  id: string;
  prompt: string;
  status: "collecting" | "revealing" | "done";
};

export type Photo = {
  id: string;
  round_id: string;
  player_id: string;
  path: string;
  revealed: boolean;
};

export type GameState = {
  current_round_id: string | null;
  current_photo_id: string | null;
  show_answer: boolean;
};

export function photoUrl(path: string) {
  return supabase.storage.from("photos").getPublicUrl(path).data.publicUrl;
}
