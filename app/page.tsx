"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { CATEGORIES, SHUFFLE, categoryName, hintFor, pickPrompt, unplayed } from "@/lib/prompts";
import { compressImage } from "@/lib/compress";
import { secondsLeft, useNow } from "@/lib/useNow";
import { Heart, Logo } from "@/app/_components/Heart";

const PLAYER_KEY = "picme-player";
const VOTES_KEY = "picme-votes"; // photo id -> guessed player id, only on this phone

const noSubscribe = () => () => {};

function readStored(): string | null {
  try {
    return localStorage.getItem(PLAYER_KEY);
  } catch {
    return null;
  }
}

function parsePlayer(raw: string | null): Player | null {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readVotes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(VOTES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export default function PlayPage() {
  // The player saved on this phone (survives refresh), or the one who just joined
  const storedRaw = useSyncExternalStore(noSubscribe, readStored, () => null);
  const stored = useMemo(() => parsePlayer(storedRaw), [storedRaw]);
  const [joined, setJoined] = useState<Player | null>(null);
  const [name, setName] = useState("");
  const [gs, setGs] = useState<GameState | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [usedPrompts, setUsedPrompts] = useState<string[]>([]);
  const [myVotes, setMyVotes] = useState<Record<string, string>>(readVotes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Game state, current round and its photos, live
  const load = useCallback(async () => {
    const [{ data: g }, { data: p }] = await Promise.all([
      supabase.from("game_state").select(GAME_STATE_COLS).eq("id", 1).single(),
      supabase.from("players").select("id,name").order("created_at"),
    ]);
    setGs(g ?? null);
    setPlayers(p ?? []);
    if (g?.phase === "lobby") {
      // Prompts already played this game, so the picker doesn't draw them again
      const { data: rs } = await supabase.from("rounds").select("prompt");
      setUsedPrompts((rs ?? []).map((r) => r.prompt));
    }
    if (g?.phase === "scoreboard") {
      const { data: s } = await supabase.rpc("scoreboard");
      setScores(s ?? []);
    }
    if (!g?.current_round_id) {
      setRound(null);
      setPhotos([]);
      return;
    }
    const [{ data: r }, { data: ph }] = await Promise.all([
      supabase.from("rounds").select(ROUND_COLS).eq("id", g.current_round_id).single(),
      supabase.from("photos").select(PHOTO_COLS).eq("round_id", g.current_round_id),
    ]);
    setRound(r ?? null);
    setPhotos(ph ?? []);
  }, []);

  // Load once the live channel is up (and again after any reconnect)
  useEffect(() => {
    const ch = supabase
      .channel("play")
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

  // Only counts while still in the game: if the host removed them or started a
  // new game, they're back on the join screen
  const saved = joined ?? stored;
  const checked = players !== null;
  const player = saved && players?.some((p) => p.id === saved.id) ? saved : null;

  const phase = gs?.phase ?? "lobby";
  const now = useNow(phase === "uploading");
  const left = secondsLeft(round?.ends_at, now);

  const myPhoto = player ? photos.find((p) => p.player_id === player.id) ?? null : null;
  const current = photos.find((p) => p.id === gs?.current_photo_id) ?? null;
  const names = useMemo(
    () => Object.fromEntries((players ?? []).map((p) => [p.id, p.name])),
    [players]
  );
  const others = (players ?? []).filter((p) => p.id !== player?.id);

  async function join() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from("players")
      .insert({ name: trimmed })
      .select("id,name")
      .single();
    setBusy(false);
    if (error?.code === "23505") {
      setError("That name is taken. Add an initial.");
      return;
    }
    if (error || !data) {
      setError("Couldn't join. Check your connection and try again.");
      return;
    }
    localStorage.setItem(PLAYER_KEY, JSON.stringify(data));
    localStorage.removeItem(VOTES_KEY);
    setMyVotes({});
    setJoined(data);
    load();
  }

  async function upload(file: File) {
    if (!player || !round) return;
    setBusy(true);
    setError(null);
    try {
      let blob: Blob;
      try {
        blob = await compressImage(file);
      } catch {
        setError("Couldn't read this photo. Try a different one, or a screenshot of it.");
        return;
      }
      const ext = blob.type === "image/jpeg" ? "jpg" : file.name.split(".").pop() || "jpg";
      const path = `${round.id}/${player.id}-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("photos")
        .upload(path, blob, { contentType: blob.type || "image/jpeg" });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase
        .from("photos")
        .upsert(
          { round_id: round.id, player_id: player.id, path, revealed: false },
          { onConflict: "round_id,player_id" }
        );
      if (dbErr) throw dbErr;

      await load();
    } catch (e) {
      const closed = e instanceof Object && "message" in e && String(e.message).includes("closed");
      setError(closed ? "Too late. Uploads are closed." : "Upload failed. Try again, or pick a smaller photo.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // --- Picking the category on your turn ---------------------------------

  const preview = gs?.preview_prompt ?? null;
  const drawnFrom = gs?.preview_from ?? null;

  function turnError(message: string) {
    setError(message.includes("turn") ? "It's not your turn anymore." : "That didn't work. Try again.");
  }

  async function pick(from: string) {
    if (!player || busy) return;
    const p = pickPrompt(from, usedPrompts, from === drawnFrom ? preview ?? undefined : undefined);
    if (!p) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("set_preview", {
      p_player: player.id,
      p_prompt: p.prompt,
      p_category: p.category,
      p_from: from,
    });
    if (error) turnError(error.message);
    await load();
    setBusy(false);
  }

  async function startMyRound() {
    if (!player || busy) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("start_previewed_round", { p_player: player.id });
    if (error) turnError(error.message);
    await load();
    setBusy(false);
  }

  async function vote(photoId: string, guessId: string) {
    if (!player) return;
    setError(null);
    const before = myVotes;
    const next = { ...myVotes, [photoId]: guessId };
    setMyVotes(next);
    const { error } = await supabase.rpc("cast_vote", {
      p_photo: photoId,
      p_voter: player.id,
      p_guess: guessId,
    });
    if (error) {
      setMyVotes(before);
      setError(error.message.includes("closed") ? "Voting is closed." : "Vote didn't go through. Try again.");
      return;
    }
    try {
      localStorage.setItem(VOTES_KEY, JSON.stringify(next));
    } catch {}
  }

  const focus =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
  const btnPrimary = `w-full rounded-full bg-rose px-6 py-4 text-lg font-semibold text-white shadow-[0_8px_24px_rgb(232_120_154/0.35)] active:scale-[0.98] disabled:opacity-40 disabled:shadow-none ${focus}`;
  const btnSecondary = `glass w-full rounded-full px-6 py-3.5 text-lg font-semibold active:scale-[0.98] disabled:opacity-40 ${focus}`;
  const muted = "mt-3 text-lg text-ink/70";
  const label = "text-sm font-semibold uppercase tracking-[0.18em] text-ink/60";

  // Small preview of your own upload
  const thumb = (path: string, caption: string) => (
    <figure className="frame mx-auto w-60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photoUrl(path)} alt="Your photo" className="aspect-square w-full object-cover" />
      <figcaption className="pb-1 pt-2 text-center text-lg font-semibold">{caption}</figcaption>
    </figure>
  );

  // Whole photo, as large as the screen allows, in a glassy frame
  const bigPhoto = (path: string, caption: ReactNode, alt: string) => (
    <figure className="frame">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photoUrl(path)} alt={alt} className="mx-auto max-h-[55dvh] w-full object-contain" />
      <figcaption className="pb-1 pt-3 text-center text-2xl font-semibold leading-tight">{caption}</figcaption>
    </figure>
  );

  let content: ReactNode = null;

  if (!checked) {
    content = null;
  } else if (!player) {
    content = (
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          join();
        }}
      >
        <div>
          <h1>
            <Logo className="text-6xl" />
          </h1>
          <p className={muted}>Show a photo. Everyone guesses whose it is.</p>
        </div>
        <label className="flex flex-col gap-2">
          <span className="font-bold">Your name</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            maxLength={24}
            autoComplete="given-name"
            className="glass rounded-full px-6 py-4 text-xl outline-none focus:ring-2 focus:ring-rose"
          />
        </label>
        <button type="submit" disabled={busy || !name.trim()} className={btnPrimary}>
          {busy ? "Joining…" : "Join game"}
        </button>
      </form>
    );
  } else if (phase === "scoreboard") {
    const mine = scores.findIndex((s) => s.player_id === player.id);
    content = (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-4xl font-bold">That&apos;s a wrap!</h1>
          {mine >= 0 && (
            <p className="mt-3 text-2xl font-bold">
              You came #{rankOf(scores, mine)} with {scores[mine].points}{" "}
              {scores[mine].points === 1 ? "point" : "points"}.
            </p>
          )}
        </div>
        <ol className="flex flex-col gap-2">
          {scores.map((s, i) => (
            <li
              key={s.player_id}
              className={`flex items-baseline gap-4 rounded-2xl px-5 py-3 ${
                s.player_id === player.id ? "border border-rose bg-rose text-white" : "glass"
              }`}
            >
              <span className="w-6 font-bold tabular-nums opacity-70">{rankOf(scores, i)}</span>
              <span className="flex-1 truncate text-lg font-semibold">{s.name}</span>
              <span className="text-lg font-bold tabular-nums">{s.points}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  } else if (phase === "uploading" && round) {
    // No timer: open until everyone's in or the host closes uploads
    const noTimer = round.ends_at === null;
    const open = noTimer || (left !== null && left > 0);
    const cat = categoryName(round.category);
    const hint = hintFor(round.prompt);
    const playerCount = players?.length ?? 0;
    content = (
      <div className="flex flex-col gap-7">
        <div>
          {cat && <p className={label}>{cat}</p>}
          <h1 className="mt-1 text-4xl font-bold leading-tight">{round.prompt}</h1>
          {hint && <p className="mt-2 text-base font-semibold text-ink/70">{hint}</p>}
        </div>

        {open && !noTimer && left !== null && (
          <p
            className={`text-7xl font-bold leading-none tabular-nums ${left <= 5 ? "text-rose" : ""}`}
          >
            {left}
            <span className="ml-2 text-2xl font-semibold text-ink/70">sec</span>
          </p>
        )}

        {myPhoto && thumb(myPhoto.path, open ? "Sent" : "In")}

        {open && myPhoto && !busy && (
          <p className="text-center text-lg font-bold" aria-live="polite">
            Waiting for others: {photos.length} of {playerCount} photos in
          </p>
        )}

        {(open || busy) && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            <button
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className={myPhoto ? btnSecondary : btnPrimary}
            >
              {busy ? "Sending…" : myPhoto ? "Change photo" : "Choose a photo"}
            </button>
          </>
        )}

        {!open && !busy && (
          <p className="text-3xl font-bold">
            {noTimer ? "Uploads are closed." : "Time's up."}{" "}
            {myPhoto ? "Your photo is in." : "You'll be in the next round."}
          </p>
        )}
      </div>
    );
  } else if ((phase === "voting" || phase === "reveal") && round && current) {
    const mine = current.player_id === player.id;
    const owner = names[current.player_id] ?? "Someone";
    const guess = myVotes[current.id];
    content = (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-bold leading-tight">{round.prompt}</h1>

        {phase === "reveal" ? (
          <>
            {bigPhoto(
              current.path,
              <span className="flex items-center justify-center gap-2 text-3xl">
                {owner}
                <Heart key={current.id} className="heart-pulse h-7 w-7 text-rose" strokeWidth={1.75} />
              </span>,
              `Photo by ${owner}`
            )}
            <p className="text-center text-xl text-ink/75">
              {mine ? "Your turn! Tell us the story." : "Tell us the story"}
            </p>
          </>
        ) : mine ? (
          <>
            {bigPhoto(current.path, "Yours", "Your photo")}
            <div>
              <p className="text-3xl font-bold">This one&apos;s yours.</p>
              <p className={muted}>Keep a straight face.</p>
            </div>
          </>
        ) : (
          <>
            {bigPhoto(current.path, <span className="text-ink/45">Who took this?</span>, "Mystery photo")}
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Who took this?">
              {others.map((c) => {
                const picked = guess === c.id;
                return (
                  <button
                    key={c.id}
                    role="radio"
                    aria-checked={picked}
                    onClick={() => vote(current.id, c.id)}
                    className={`min-h-14 truncate rounded-2xl px-4 py-3 text-lg font-semibold active:scale-[0.98] ${focus} ${
                      picked ? "border border-rose bg-rose text-white" : "glass"
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
            <p className="text-base font-semibold" aria-live="polite">
              {guess
                ? `Vote sent: ${names[guess] ?? "someone"}. You can change it until voting closes.`
                : "Your vote stays secret."}
            </p>
          </>
        )}
      </div>
    );
  } else if (phase === "voting" || phase === "reveal") {
    content = (
      <div>
        <h1 className="text-4xl font-bold">Eyes on the big screen.</h1>
      </div>
    );
  } else if (phase === "lobby" && gs?.pick_mode === "players" && gs.picker_id === player.id) {
    const chip = (on: boolean) =>
      `rounded-full px-4 py-2.5 text-base font-semibold active:scale-[0.98] disabled:opacity-40 ${focus} ${
        on ? "border border-rose bg-rose text-white" : "glass"
      }`;
    const allPlayed = (from: string) => unplayed(from, usedPrompts).length === 0;
    const noneLeft = !!drawnFrom && !!preview && unplayed(drawnFrom, usedPrompts, preview).length === 0;
    const cat = categoryName(gs.preview_category);
    content = (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-4xl font-bold">Your turn to pick!</h1>
          <p className={muted}>Choose a category. Everyone gets the same prompt.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => pick(SHUFFLE)}
            disabled={busy || allPlayed(SHUFFLE)}
            aria-pressed={drawnFrom === SHUFFLE}
            className={chip(drawnFrom === SHUFFLE)}
          >
            Shuffle
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              disabled={busy || allPlayed(c.id)}
              aria-pressed={drawnFrom === c.id}
              className={`${chip(drawnFrom === c.id)} ${allPlayed(c.id) ? "line-through" : ""}`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {preview && (
          <div className="glass rounded-3xl p-5" aria-live="polite">
            <p className={label}>{cat ?? "From the host"}</p>
            <p className="mt-1 text-2xl font-bold leading-tight">{preview}</p>
            {drawnFrom && (
              <button
                onClick={() => pick(drawnFrom)}
                disabled={busy || noneLeft}
                className={`${btnSecondary} mt-4`}
              >
                {noneLeft ? "No other prompts left here" : "Another prompt"}
              </button>
            )}
          </div>
        )}

        <button onClick={startMyRound} disabled={busy || !preview} className={btnPrimary}>
          Start round
        </button>
      </div>
    );
  } else if (phase === "lobby" && gs?.pick_mode === "players" && gs.picker_id && names[gs.picker_id]) {
    content = (
      <div>
        <h1 className="text-4xl font-bold">{names[gs.picker_id]} is picking the category…</h1>
        <p className={muted}>The prompt shows up here when the round starts.</p>
      </div>
    );
  } else {
    content = (
      <div>
        <h1 className="text-4xl font-bold">You&apos;re in, {player.name}.</h1>
        <p className={muted}>The next prompt shows up here.</p>
      </div>
    );
  }

  return (
    <main className="min-h-dvh px-6 pb-12 pt-6">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        {checked && player && <Logo className="text-xl" />}
        {content}
        {error && (
          <p role="alert" className="glass rounded-2xl border-rose! px-5 py-3 font-semibold">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
