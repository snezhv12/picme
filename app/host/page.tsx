"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  supabase,
  photoUrl,
  rankOf,
  GAME_STATE_COLS,
  PHOTO_COLS,
  ROUND_COLS,
  type GameState,
  type Photo,
  type Player,
  type Round,
  type Score,
} from "@/lib/supabase";
import { CATEGORIES, SHUFFLE, categoryName, pickPrompt, type Pick } from "@/lib/prompts";
import { secondsLeft, useNow } from "@/lib/useNow";
import { display, hand } from "@/lib/fonts";
import { Confetti } from "@/app/_components/Confetti";

const TIMER_OPTIONS = [20, 40, 60];

type Action = { label: string; run: () => void; disabled?: boolean } | null;
type GalleryItem = { id: string; path: string; prompt: string; name: string };

const noSubscribe = () => () => {};

export default function HostPage() {
  const [gs, setGs] = useState<GameState | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [usedPrompts, setUsedPrompts] = useState<string[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [busy, setBusy] = useState(false);

  // Lobby setup, only on this screen until the round starts
  const [preview, setPreview] = useState<Pick | null>(null);
  const [drawnFrom, setDrawnFrom] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [seconds, setSeconds] = useState(TIMER_OPTIONS[0]);

  const [gallery, setGallery] = useState<GalleryItem[] | null>(null);

  const joinUrl = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => ""
  );

  const load = useCallback(async () => {
    const [{ data: g }, { data: p }, { data: rs }] = await Promise.all([
      supabase.from("game_state").select(GAME_STATE_COLS).eq("id", 1).single(),
      supabase.from("players").select("id,name").order("created_at"),
      supabase.from("rounds").select("prompt"),
    ]);
    setGs(g ?? null);
    setPlayers(p ?? []);
    setUsedPrompts((rs ?? []).map((r) => r.prompt));

    if (g?.current_round_id) {
      const [{ data: r }, { data: ph }] = await Promise.all([
        supabase.from("rounds").select(ROUND_COLS).eq("id", g.current_round_id).single(),
        supabase.from("photos").select(PHOTO_COLS).eq("round_id", g.current_round_id),
      ]);
      setRound(r ?? null);
      setPhotos(ph ?? []);
    } else {
      setRound(null);
      setPhotos([]);
    }

    if (g?.phase === "scoreboard") {
      const { data: s } = await supabase.rpc("scoreboard");
      setScores(s ?? []);
    } else {
      setGallery(null);
    }
  }, []);

  // Load once the live channel is up (and again after any reconnect)
  useEffect(() => {
    const ch = supabase
      .channel("host")
      .on("postgres_changes", { event: "*", schema: "public", table: "game_state" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "photos" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, load)
      .subscribe((status) => {
        if (status !== "CLOSED") load();
      });
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  async function run(fn: () => PromiseLike<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
    } finally {
      setBusy(false);
    }
  }

  const phase = gs?.phase ?? "lobby";
  const current = photos.find((p) => p.id === gs?.current_photo_id) ?? null;
  const names = useMemo(
    () => Object.fromEntries(players.map((p) => [p.id, p.name])),
    [players]
  );
  const isLast = !!current && current.position === photos.length;
  const allIn = players.length > 0 && photos.length >= players.length;
  const eligibleVoters = current
    ? players.filter((p) => p.id !== current.player_id).length
    : 0;

  const now = useNow(phase === "uploading");
  const left = secondsLeft(round?.ends_at, now);
  const timeUp = left === 0;

  // --- Lobby ---------------------------------------------------------------

  function draw(from: string) {
    setDrawnFrom(from);
    setPreview(pickPrompt(from, usedPrompts, preview?.prompt));
  }

  function applyCustom() {
    const t = custom.trim();
    if (!t) return;
    setDrawnFrom(null);
    setPreview({ prompt: t, category: "" });
    setCustom("");
  }

  const startRound = () =>
    run(async () => {
      if (!preview) return;
      const { error } = await supabase.rpc("start_round", {
        p_prompt: preview.prompt,
        p_category: preview.category || null,
        p_seconds: seconds,
      });
      if (!error) {
        setPreview(null);
        setDrawnFrom(null);
      }
    });

  const removePlayer = (id: string) =>
    run(() => supabase.from("players").delete().eq("id", id));

  // --- Game moves (all on the server, so every screen stays in step) -------

  const addTime = () => run(() => supabase.rpc("add_time", { p_seconds: 10 }));
  const endUploads = () => run(() => supabase.rpc("end_uploads"));
  const closeVoting = () =>
    run(() => supabase.rpc("close_voting", { p_photo: current?.id }));
  const nextPhoto = () => run(() => supabase.rpc("next_photo", { p_current: current?.id }));
  const backToLobby = () => run(() => supabase.rpc("back_to_lobby"));
  const endGame = () => run(() => supabase.rpc("end_game"));
  const playAgain = () => run(() => supabase.rpc("play_again"));

  const newGame = () => {
    if (!confirm("Start a new game? This removes all players, photos and votes.")) return;
    run(() => supabase.rpc("new_game"));
  };

  // Uploads end by themselves when the clock runs out (after a short grace for
  // uploads already on their way) or as soon as everyone has a photo in
  const autoEnd = phase === "uploading" && photos.length > 0 && (timeUp || allIn);
  useEffect(() => {
    if (!autoEnd) return;
    const t = setTimeout(() => supabase.rpc("end_uploads").then(load), timeUp ? 3000 : 1500);
    return () => clearTimeout(t);
  }, [autoEnd, timeUp, load]);

  async function openGallery() {
    const [{ data: ph }, { data: rs }] = await Promise.all([
      supabase.from("photos").select("id,path,round_id,player_id,position,created_at"),
      supabase.from("rounds").select("id,prompt,created_at"),
    ]);
    const roundOrder = new Map((rs ?? []).map((r) => [r.id, r]));
    const items = (ph ?? [])
      .filter((p) => roundOrder.has(p.round_id))
      .sort((a, b) => {
        const ra = roundOrder.get(a.round_id)!.created_at;
        const rb = roundOrder.get(b.round_id)!.created_at;
        if (ra !== rb) return ra < rb ? -1 : 1;
        return (a.position ?? 999) - (b.position ?? 999);
      })
      .map((p) => ({
        id: p.id,
        path: p.path,
        prompt: roundOrder.get(p.round_id)!.prompt,
        name: names[p.player_id] ?? "Someone",
      }));
    setGallery(items);
  }

  // --- The one main button per moment (Space or → also presses it) ---------

  let primary: Action = null;
  if (phase === "lobby") {
    primary = { label: "Start round", run: startRound, disabled: !preview };
  } else if (phase === "uploading") {
    primary =
      timeUp && photos.length === 0
        ? { label: "Back to lobby", run: backToLobby }
        : { label: "End timer now", run: endUploads };
  } else if (phase === "voting") {
    primary = { label: "Close voting", run: closeVoting, disabled: !current };
  } else if (phase === "reveal") {
    primary = isLast
      ? { label: "Next round", run: backToLobby }
      : { label: "Next photo", run: nextPhoto, disabled: !current };
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

  // --- Pieces ----------------------------------------------------------------

  const focus =
    "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-rose";
  const btnPrimary = `rounded-full bg-ink px-10 py-5 text-2xl font-bold text-petal transition active:scale-[0.98] disabled:opacity-30 ${focus}`;
  const btnSecondary = `rounded-full border-[3px] border-ink px-7 py-3.5 text-xl font-bold transition active:scale-[0.98] disabled:opacity-30 ${focus}`;
  const label = "text-xl font-bold uppercase tracking-widest text-rose";

  const primaryButton = primary && (
    <button onClick={primary.run} disabled={busy || primary.disabled} className={btnPrimary}>
      {primary.label}
    </button>
  );

  const qr = (
    <figure className="w-[min(22vw,300px)] shrink-0 rotate-2 bg-petal p-4 pb-2 shadow-2xl shadow-ink/20">
      {joinUrl && (
        <QRCodeSVG value={joinUrl} size={512} bgColor="#fff4f8" fgColor="#2a0e1f" className="h-auto w-full" />
      )}
      <figcaption className="py-2 text-center">
        <span className={`${hand.className} block text-4xl`}>Scan to join</span>
        <span className="block break-all text-lg font-bold">{joinUrl.replace(/^https?:\/\//, "")}</span>
      </figcaption>
    </figure>
  );

  const roundCategory = categoryName(round?.category);

  let body: ReactNode = null;

  if (phase === "lobby") {
    const previewCategory = categoryName(preview?.category);
    body = (
      <section className="flex flex-1 items-start justify-between gap-[4vw] pt-6">
        <div className="flex max-w-5xl flex-1 flex-col gap-7">
          <h1 className="text-[clamp(2.5rem,4.5vw,4.5rem)] font-extrabold leading-[1.05]">
            {usedPrompts.length > 0 ? "Next round. Pick a category." : "Pick a category."}
          </h1>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => draw(SHUFFLE)}
              aria-pressed={drawnFrom === SHUFFLE}
              className={`rounded-full px-7 py-3.5 text-xl font-bold transition active:scale-[0.98] ${focus} ${
                drawnFrom === SHUFFLE ? "bg-ink text-petal" : "bg-rose text-petal"
              }`}
            >
              Shuffle
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => draw(c.id)}
                aria-pressed={drawnFrom === c.id}
                className={`${btnSecondary} ${drawnFrom === c.id ? "bg-ink text-petal" : ""}`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <form
            className="flex max-w-3xl gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              applyCustom();
            }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="…or write my own prompt"
              maxLength={120}
              aria-label="Write my own prompt"
              className="min-w-0 flex-1 rounded-2xl border-[3px] border-ink bg-petal px-5 py-3 text-xl outline-none placeholder:text-ink/50 focus:ring-4 focus:ring-rose"
            />
            <button type="submit" disabled={!custom.trim()} className={btnSecondary}>
              Use
            </button>
          </form>

          <div className="min-h-44 rounded-3xl bg-petal p-7 shadow-xl shadow-ink/10">
            {preview ? (
              <>
                <p className={label}>{previewCategory ?? "Your own prompt"}</p>
                <p className="mt-2 text-[clamp(2rem,3.6vw,3.5rem)] font-extrabold leading-tight">
                  {preview.prompt}
                </p>
                {drawnFrom && (
                  <button onClick={() => draw(drawnFrom)} className={`${btnSecondary} mt-5`}>
                    Another prompt
                  </button>
                )}
              </>
            ) : (
              <p className="text-2xl font-semibold text-ink/60">
                The prompt shows up here before the round starts.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-6">
            {primaryButton}
            <div role="radiogroup" aria-label="Upload time" className="flex items-center gap-2">
              <span className="mr-2 text-xl font-bold">Timer</span>
              {TIMER_OPTIONS.map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={seconds === s}
                  onClick={() => setSeconds(s)}
                  className={`rounded-full border-[3px] border-ink px-5 py-2 text-xl font-bold ${focus} ${
                    seconds === s ? "bg-ink text-petal" : ""
                  }`}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className="flex w-[min(24vw,320px)] shrink-0 flex-col items-center gap-6">
          {qr}
          <div className="w-full">
            <p className="text-2xl font-extrabold">
              {players.length} {players.length === 1 ? "player" : "players"}
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {players.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-1 rounded-full bg-petal py-1 pl-4 pr-1 text-lg font-semibold"
                >
                  {p.name}
                  <button
                    onClick={() => removePlayer(p.id)}
                    disabled={busy}
                    aria-label={`Remove ${p.name}`}
                    className={`grid h-7 w-7 place-items-center rounded-full text-base text-ink/60 hover:bg-ink hover:text-petal ${focus}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </section>
    );
  } else if (phase === "uploading" && round) {
    const noPhotos = timeUp && photos.length === 0;
    body = (
      <section className="flex flex-1 items-center justify-between gap-[5vw]">
        <div className="flex max-w-4xl flex-1 flex-col gap-8">
          {roundCategory && <p className={label}>{roundCategory}</p>}
          <h1 className="text-[clamp(3rem,6.5vw,7rem)] font-extrabold leading-[1.02]">{round.prompt}</h1>

          {noPhotos ? (
            <p className="text-4xl font-bold">No photos this round.</p>
          ) : (
            <div className="flex items-baseline gap-8">
              <span
                className={`text-[clamp(5rem,11vw,10rem)] font-extrabold leading-none tabular-nums ${
                  left !== null && left <= 5 ? "text-rose" : ""
                }`}
              >
                {timeUp ? "Time!" : left}
              </span>
              <span className="text-3xl font-semibold text-ink/75">
                {photos.length} of {players.length} photos in
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            {primaryButton}
            {!timeUp && (
              <button onClick={addTime} disabled={busy} className={btnSecondary}>
                +10 seconds
              </button>
            )}
          </div>
        </div>
        {qr}
      </section>
    );
  } else if ((phase === "voting" || phase === "reveal") && round) {
    const reveal = phase === "reveal";
    body = (
      <section className="flex flex-1 flex-col items-center justify-center gap-6 pt-2">
        <h1 className="max-w-5xl text-center text-[clamp(2rem,4vw,3.75rem)] font-extrabold leading-tight">
          {round.prompt}
        </h1>

        {current && (
          <figure className="-rotate-1 bg-petal p-5 pb-3 shadow-2xl shadow-ink/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl(current.path)}
              alt={reveal ? `Photo by ${names[current.player_id] ?? "someone"}` : "Mystery photo"}
              className="max-h-[56vh] max-w-[80vw] object-contain"
            />
            <figcaption className="pt-3 text-center">
              <span
                className={`${hand.className} block text-6xl leading-none ${reveal ? "" : "text-ink/40"}`}
              >
                {reveal ? names[current.player_id] ?? "Someone" : "Who took this?"}
              </span>
              {reveal && <span className="mt-1 block text-2xl font-bold">Tell us the story</span>}
            </figcaption>
          </figure>
        )}

        <div className="flex flex-wrap items-center justify-center gap-6">
          {primaryButton}
          {reveal && isLast && (
            <button onClick={endGame} disabled={busy} className={btnSecondary}>
              End game
            </button>
          )}
          <span className="text-2xl font-semibold text-ink/70">
            Photo {current?.position ?? "–"} of {photos.length}
            {!reveal && ` · ${gs?.vote_count ?? 0} of ${eligibleVoters} voted`}
          </span>
        </div>
      </section>
    );
  } else if (phase === "scoreboard" && gallery) {
    body = (
      <section className="flex flex-1 flex-col gap-8 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-[clamp(2.5rem,5vw,5rem)] font-extrabold leading-none">All the photos</h1>
          <button onClick={() => setGallery(null)} className={btnSecondary}>
            Back to scores
          </button>
        </div>
        {gallery.length === 0 ? (
          <p className="text-3xl font-semibold">No photos this game.</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-8">
            {gallery.map((g, i) => (
              <li key={g.id}>
                <figure className={`bg-petal p-3 pb-2 shadow-xl shadow-ink/15 ${i % 2 ? "rotate-1" : "-rotate-1"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrl(g.path)} alt={`${g.prompt}, by ${g.name}`} className="aspect-square w-full object-cover" />
                  <figcaption className="pt-2">
                    <span className={`${hand.className} block text-4xl leading-none`}>{g.name}</span>
                    <span className="block text-base font-semibold text-ink/70">{g.prompt}</span>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  } else if (phase === "scoreboard") {
    body = (
      <section className="flex flex-1 flex-col items-center justify-center gap-8">
        <Confetti />
        <h1 className="text-[clamp(3rem,6vw,6rem)] font-extrabold leading-none">Final scores</h1>
        <ol className="flex w-full max-w-3xl flex-col gap-3">
          {scores.map((s, i) => {
            const rank = rankOf(scores, i);
            const winner = rank === 1 && s.points > 0;
            return (
              <li
                key={s.player_id}
                className={`flex items-baseline gap-6 rounded-3xl px-8 ${
                  winner ? "bg-ink py-6 text-petal" : "bg-petal py-4"
                }`}
              >
                <span className="w-12 text-3xl font-bold tabular-nums opacity-70">
                  {i === 0 || scores[i - 1].points !== s.points ? rank : ""}
                </span>
                <span className={`flex-1 truncate font-bold ${winner ? "text-5xl" : "text-4xl"}`}>
                  {winner && "👑 "}
                  {s.name}
                </span>
                <span className="text-4xl font-extrabold tabular-nums">
                  {s.points}{" "}
                  <span className="text-2xl font-semibold opacity-70">{s.points === 1 ? "pt" : "pts"}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap justify-center gap-4">
          <button onClick={openGallery} className={btnPrimary}>
            See all photos
          </button>
          <button onClick={playAgain} disabled={busy} className={btnSecondary}>
            Play again
          </button>
          <button onClick={newGame} disabled={busy} className={btnSecondary}>
            New game
          </button>
        </div>
      </section>
    );
  }

  return (
    <main className={`${display.className} flex min-h-dvh flex-col bg-blush px-[5vw] py-8 text-ink`}>
      <header className="flex items-baseline justify-between">
        <p className="text-4xl font-extrabold tracking-tight">
          Pic<span className="text-rose">Me</span>
        </p>
        <div className="flex items-baseline gap-6 text-lg font-semibold text-ink/70">
          {phase !== "lobby" && phase !== "scoreboard" && (
            <span>
              {players.length} {players.length === 1 ? "player" : "players"}
            </span>
          )}
          {phase === "lobby" && (
            <button onClick={endGame} disabled={busy} className="underline-offset-4 hover:underline">
              End game
            </button>
          )}
          {phase !== "scoreboard" && (
            <button onClick={newGame} className="underline-offset-4 hover:underline">
              New game
            </button>
          )}
        </div>
      </header>
      {body}
    </main>
  );
}
