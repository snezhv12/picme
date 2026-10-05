"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  supabase,
  photoUrl,
  type GameState,
  type Photo,
  type Player,
  type Round,
} from "@/lib/supabase";
import { display, hand } from "@/lib/fonts";

const PROMPTS = [
  "The last photo you took of food",
  "Your most chaotic screenshot",
  "A photo that needs context",
  "The oldest photo in your camera roll",
  "Your worst selfie",
  "The view from a trip you loved",
  "A photo with the birthday star",
  "Something you bought and regret",
  "A photo that sums up your summer",
  "The most recent photo of a pet",
  "Your fridge, right now",
  "A photo you'd never post",
];

type Action = { label: string; run: () => void; disabled?: boolean } | null;

export default function HostPage() {
  const [gs, setGs] = useState<GameState | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [prompt, setPrompt] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setJoinUrl(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    const [{ data: g }, { data: p }] = await Promise.all([
      supabase
        .from("game_state")
        .select("current_round_id,current_photo_id,show_answer")
        .eq("id", 1)
        .single(),
      supabase.from("players").select("id,name").order("created_at"),
    ]);
    setGs(g ?? null);
    setPlayers(p ?? []);

    if (g?.current_round_id) {
      const [{ data: r }, { data: ph }] = await Promise.all([
        supabase.from("rounds").select("id,prompt,status").eq("id", g.current_round_id).single(),
        supabase
          .from("photos")
          .select("id,round_id,player_id,path,revealed")
          .eq("round_id", g.current_round_id),
      ]);
      setRound(r ?? null);
      setPhotos(ph ?? []);
    } else {
      setRound(null);
      setPhotos([]);
    }
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("host")
      .on("postgres_changes", { event: "*", schema: "public", table: "game_state" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "photos" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function pickNext() {
    const left = photos.filter((p) => !p.revealed);
    if (!left.length) return;
    const next = left[Math.floor(Math.random() * left.length)];
    await supabase.from("photos").update({ revealed: true }).eq("id", next.id);
    await supabase
      .from("game_state")
      .update({ current_photo_id: next.id, show_answer: false })
      .eq("id", 1);
  }

  const startRound = (text: string) =>
    run(async () => {
      const t = text.trim();
      if (!t) return;
      const { data: r, error } = await supabase
        .from("rounds")
        .insert({ prompt: t })
        .select("id")
        .single();
      if (error || !r) return;
      await supabase
        .from("game_state")
        .update({ current_round_id: r.id, current_photo_id: null, show_answer: false })
        .eq("id", 1);
      setPrompt("");
    });

  const startReveal = () =>
    run(async () => {
      if (!round) return;
      await supabase.from("rounds").update({ status: "revealing" }).eq("id", round.id);
      await pickNext();
    });

  const nextPhoto = () => run(pickNext);

  const showAnswer = () =>
    run(async () => {
      await supabase.from("game_state").update({ show_answer: true }).eq("id", 1);
    });

  const endRound = () =>
    run(async () => {
      if (round) await supabase.from("rounds").update({ status: "done" }).eq("id", round.id);
      await supabase
        .from("game_state")
        .update({ current_round_id: null, current_photo_id: null, show_answer: false })
        .eq("id", 1);
    });

  const newGame = () => {
    if (!confirm("Start a new game? This removes all players and photos.")) return;
    run(async () => {
      await supabase
        .from("game_state")
        .update({ current_round_id: null, current_photo_id: null, show_answer: false })
        .eq("id", 1);
      await supabase.from("rounds").delete().not("id", "is", null);
      await supabase.from("players").delete().not("id", "is", null);
    });
  };

  const names = useMemo(
    () => Object.fromEntries(players.map((p) => [p.id, p.name])),
    [players]
  );
  const current = photos.find((p) => p.id === gs?.current_photo_id) ?? null;
  const shown = photos.filter((p) => p.revealed).length;
  const remaining = photos.length - shown;
  const phase = !round || round.status === "done" ? "setup" : round.status;

  // The one main button for each moment (Space or → also triggers it)
  let primary: Action = null;
  if (phase === "collecting") {
    primary = { label: "Reveal photos", run: startReveal, disabled: photos.length === 0 };
  } else if (phase === "revealing") {
    if (!current) primary = { label: "Show first photo", run: nextPhoto, disabled: remaining === 0 };
    else if (!gs?.show_answer) primary = { label: "Who was it?", run: showAnswer };
    else if (remaining > 0) primary = { label: "Next photo", run: nextPhoto };
    else primary = { label: "End round", run: endRound };
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT") return;
      if (e.key === " " && tag === "BUTTON") return; // button handles it itself
      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault();
        if (primary && !primary.disabled && !busy) primary.run();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const btnPrimary =
    "rounded-full bg-[#FFD23F] px-10 py-5 text-2xl font-bold text-[#1A0A26] transition active:scale-[0.98] disabled:opacity-40 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[#FF5C8A]";

  const qr = (
    <figure className="w-[min(26vw,340px)] rotate-2 bg-[#FBF8F2] p-4 pb-2 shadow-2xl">
      {joinUrl && (
        <QRCodeSVG
          value={joinUrl}
          size={512}
          bgColor="#FBF8F2"
          fgColor="#1A0A26"
          className="h-auto w-full"
        />
      )}
      <figcaption className={`${hand.className} py-2 text-center text-4xl text-[#1A0A26]`}>
        Scan to join
      </figcaption>
    </figure>
  );

  return (
    <main
      className={`${display.className} flex min-h-dvh flex-col bg-[#2E1046] px-[5vw] py-8 text-[#FBF8F2]`}
    >
      <header className="flex items-baseline justify-between">
        <p className="text-3xl font-extrabold tracking-tight">PicMe</p>
        <div className="flex items-baseline gap-6 text-lg text-[#FBF8F2]/70">
          <span>
            {players.length} {players.length === 1 ? "player" : "players"}
          </span>
          <button onClick={newGame} className="underline-offset-4 hover:underline">
            New game
          </button>
        </div>
      </header>

      {phase === "setup" && (
        <section className="flex flex-1 items-center justify-between gap-[5vw]">
          <div className="flex max-w-3xl flex-1 flex-col gap-6">
            <h1 className="text-[clamp(2.5rem,5vw,5rem)] font-extrabold leading-[1.05]">
              What should everyone show?
            </h1>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                startRound(prompt);
              }}
            >
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Type a prompt"
                className="rounded-2xl bg-[#FBF8F2] px-6 py-5 text-2xl text-[#1A0A26] outline-none focus:ring-4 focus:ring-[#FF5C8A]"
              />
              <div className="flex flex-wrap gap-4">
                <button type="submit" disabled={busy || !prompt.trim()} className={btnPrimary}>
                  Start round
                </button>
                <button
                  type="button"
                  onClick={() => setPrompt(PROMPTS[Math.floor(Math.random() * PROMPTS.length)])}
                  className="rounded-full border-2 border-[#FBF8F2]/40 px-8 py-5 text-xl font-semibold"
                >
                  Surprise me
                </button>
              </div>
            </form>
            {players.length > 0 && (
              <ul className="flex flex-wrap gap-2 pt-4">
                {players.map((p) => (
                  <li key={p.id} className="rounded-full bg-[#4A1D6B] px-4 py-1.5 text-lg">
                    {p.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {qr}
        </section>
      )}

      {phase === "collecting" && round && (
        <section className="flex flex-1 items-center justify-between gap-[5vw]">
          <div className="flex max-w-4xl flex-1 flex-col gap-10">
            <h1 className="text-[clamp(3rem,6vw,6.5rem)] font-extrabold leading-[1.02]">
              {round.prompt}
            </h1>
            <p className="text-3xl text-[#FBF8F2]/80">
              {photos.length} of {players.length} photos in
            </p>
            {primary && (
              <div>
                <button onClick={primary.run} disabled={busy || primary.disabled} className={btnPrimary}>
                  {primary.label}
                </button>
              </div>
            )}
          </div>
          {qr}
        </section>
      )}

      {phase === "revealing" && round && (
        <section className="flex flex-1 flex-col items-center justify-center gap-6 pt-4">
          <p className="max-w-4xl text-center text-2xl text-[#FBF8F2]/70">{round.prompt}</p>

          {current ? (
            <figure className="-rotate-1 bg-[#FBF8F2] p-5 pb-3 shadow-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl(current.path)}
                alt="Mystery photo"
                className="max-h-[60vh] max-w-[80vw] object-contain"
              />
              <figcaption
                className={`${hand.className} pt-3 text-center text-6xl leading-none ${
                  gs?.show_answer ? "text-[#1A0A26]" : "text-[#1A0A26]/30"
                }`}
              >
                {gs?.show_answer ? names[current.player_id] ?? "Someone" : "Who took this?"}
              </figcaption>
            </figure>
          ) : (
            <p className="text-3xl">No photos yet.</p>
          )}

          <div className="flex items-center gap-8">
            {primary && (
              <button onClick={primary.run} disabled={busy || primary.disabled} className={btnPrimary}>
                {primary.label}
              </button>
            )}
            <span className="text-xl text-[#FBF8F2]/60">
              Photo {shown} of {photos.length}
            </span>
          </div>
        </section>
      )}
    </main>
  );
}
