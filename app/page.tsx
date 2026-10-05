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
import { categoryName } from "@/lib/prompts";
import { compressImage } from "@/lib/compress";
import { secondsLeft, useNow } from "@/lib/useNow";
import { display, hand } from "@/lib/fonts";

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
    "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-rose";
  const btnPrimary = `w-full rounded-full bg-ink px-6 py-4 text-lg font-bold text-petal active:scale-[0.98] disabled:opacity-40 ${focus}`;
  const btnSecondary = `w-full rounded-full border-[3px] border-ink px-6 py-3.5 text-lg font-bold disabled:opacity-40 ${focus}`;
  const muted = "mt-3 text-lg text-ink/75";
  const label = "text-sm font-bold uppercase tracking-widest text-rose";

  const polaroid = (path: string, caption: string, small = false) => (
    <figure
      className={`mx-auto -rotate-2 bg-petal p-3 pb-2 shadow-2xl shadow-ink/20 ${small ? "w-56" : "w-64"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photoUrl(path)} alt="" className="aspect-square w-full object-cover" />
      <figcaption className={`${hand.className} py-1 text-center text-3xl`}>{caption}</figcaption>
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
          <h1 className="text-6xl font-extrabold tracking-tight">
            Pic<span className="text-rose">Me</span>
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
            className="rounded-2xl border-[3px] border-ink bg-petal px-5 py-4 text-xl outline-none focus:ring-4 focus:ring-rose"
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
          <h1 className="text-4xl font-extrabold">That&apos;s a wrap!</h1>
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
                s.player_id === player.id ? "bg-ink text-petal" : "bg-petal"
              }`}
            >
              <span className="w-6 font-bold tabular-nums opacity-70">{rankOf(scores, i)}</span>
              <span className="flex-1 truncate text-lg font-bold">{s.name}</span>
              <span className="text-lg font-extrabold tabular-nums">{s.points}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  } else if (phase === "uploading" && round) {
    const open = left !== null && left > 0;
    const cat = categoryName(round.category);
    content = (
      <div className="flex flex-col gap-7">
        <div>
          {cat && <p className={label}>{cat}</p>}
          <h1 className="mt-1 text-4xl font-extrabold leading-tight">{round.prompt}</h1>
        </div>

        {open && (
          <p
            className={`text-7xl font-extrabold leading-none tabular-nums ${left <= 5 ? "text-rose" : ""}`}
          >
            {left}
            <span className="ml-2 text-2xl font-semibold text-ink/70">sec</span>
          </p>
        )}

        {myPhoto && polaroid(myPhoto.path, open ? "Sent" : "In!")}

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

        {left === 0 && !busy && (
          <p className="text-3xl font-extrabold">
            {myPhoto ? "Time's up. Your photo is in." : "Time's up. You'll be in the next round."}
          </p>
        )}
      </div>
    );
  } else if (phase === "voting" && round && current) {
    const guess = myVotes[current.id];
    content = (
      <div className="flex flex-col gap-6">
        <p className="text-lg font-semibold text-ink/75">{round.prompt}</p>
        {current.player_id === player.id ? (
          <>
            {polaroid(current.path, "Yours", true)}
            <div>
              <h1 className="text-4xl font-extrabold">This one&apos;s yours.</h1>
              <p className={muted}>Keep a straight face.</p>
            </div>
          </>
        ) : (
          <>
            {polaroid(current.path, "Who took this?", true)}
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Who took this?">
              {others.map((c) => {
                const picked = guess === c.id;
                return (
                  <button
                    key={c.id}
                    role="radio"
                    aria-checked={picked}
                    onClick={() => vote(current.id, c.id)}
                    className={`min-h-14 truncate rounded-2xl border-[3px] border-ink px-4 py-3 text-lg font-bold active:scale-[0.98] ${focus} ${
                      picked ? "bg-ink text-petal" : "bg-petal"
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
        <h1 className="text-4xl font-extrabold">Eyes on the big screen.</h1>
      </div>
    );
  } else {
    content = (
      <div>
        <h1 className="text-4xl font-extrabold">You&apos;re in, {player.name}.</h1>
        <p className={muted}>The next prompt shows up here.</p>
      </div>
    );
  }

  return (
    <main className={`${display.className} min-h-dvh bg-blush px-6 py-12 text-ink`}>
      <div className="mx-auto flex max-w-md flex-col gap-6">
        {content}
        {error && (
          <p role="alert" className="rounded-xl bg-rose px-4 py-3 font-semibold text-petal">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
