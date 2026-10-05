"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase, photoUrl, type Player, type Round } from "@/lib/supabase";
import { compressImage } from "@/lib/compress";
import { display, hand } from "@/lib/fonts";

const PLAYER_KEY = "picme-player";

export default function PlayPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [checked, setChecked] = useState(false);
  const [name, setName] = useState("");
  const [round, setRound] = useState<Round | null>(null);
  const [myPhoto, setMyPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Remember the player on this phone (survives refresh)
  useEffect(() => {
    let saved: Player | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(PLAYER_KEY) ?? "null");
    } catch {}
    if (!saved) {
      setChecked(true);
      return;
    }
    supabase
      .from("players")
      .select("id,name")
      .eq("id", saved.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPlayer(data);
        else localStorage.removeItem(PLAYER_KEY); // game was reset
        setChecked(true);
      });
  }, []);

  // Current round, live
  const loadRound = useCallback(async () => {
    const { data: gs } = await supabase
      .from("game_state")
      .select("current_round_id")
      .eq("id", 1)
      .single();
    if (!gs?.current_round_id) {
      setRound(null);
      return;
    }
    const { data: r } = await supabase
      .from("rounds")
      .select("id,prompt,status")
      .eq("id", gs.current_round_id)
      .single();
    setRound(r ?? null);
  }, []);

  useEffect(() => {
    loadRound();
    const ch = supabase
      .channel("play")
      .on("postgres_changes", { event: "*", schema: "public", table: "game_state" }, loadRound)
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, loadRound)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadRound]);

  // Did I already send a photo this round?
  const roundId = round?.id;
  useEffect(() => {
    if (!player || !roundId) {
      setMyPhoto(null);
      return;
    }
    supabase
      .from("photos")
      .select("path")
      .eq("round_id", roundId)
      .eq("player_id", player.id)
      .maybeSingle()
      .then(({ data }) => setMyPhoto(data?.path ?? null));
  }, [player, roundId]);

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
    if (error || !data) {
      setError("Couldn't join. Check your connection and try again.");
      return;
    }
    localStorage.setItem(PLAYER_KEY, JSON.stringify(data));
    setPlayer(data);
  }

  async function upload(file: File) {
    if (!player || !round) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await compressImage(file);
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

      setMyPhoto(path);
    } catch {
      setError("Upload failed. Try again, or pick a smaller photo.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const btnPrimary =
    "w-full rounded-full bg-[#FFD23F] px-6 py-4 text-lg font-bold text-[#1A0A26] active:scale-[0.98] disabled:opacity-50 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#FF5C8A]";
  const btnSecondary =
    "w-full rounded-full border-2 border-[#FBF8F2]/40 px-6 py-3 font-semibold text-[#FBF8F2] disabled:opacity-50 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#FF5C8A]";

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
          <h1 className="text-6xl font-extrabold tracking-tight">PicMe</h1>
          <p className="mt-3 text-lg text-[#FBF8F2]/75">
            Show a photo. Everyone guesses whose it is.
          </p>
        </div>
        <label className="flex flex-col gap-2">
          <span className="font-semibold">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            autoComplete="given-name"
            className="rounded-2xl bg-[#FBF8F2] px-5 py-4 text-xl text-[#1A0A26] outline-none focus:ring-4 focus:ring-[#FF5C8A]"
          />
        </label>
        <button type="submit" disabled={busy || !name.trim()} className={btnPrimary}>
          {busy ? "Joining…" : "Join game"}
        </button>
      </form>
    );
  } else if (!round || round.status === "done") {
    content = (
      <div>
        <h1 className="text-4xl font-extrabold">You&apos;re in, {player.name}.</h1>
        <p className="mt-3 text-lg text-[#FBF8F2]/75">The next prompt shows up here.</p>
      </div>
    );
  } else if (round.status === "collecting") {
    content = (
      <div className="flex flex-col gap-8">
        <h1 className="text-4xl font-extrabold leading-tight">{round.prompt}</h1>

        {myPhoto && (
          <figure className="mx-auto w-64 -rotate-2 bg-[#FBF8F2] p-3 pb-2 shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl(myPhoto)} alt="Your photo" className="aspect-square w-full object-cover" />
            <figcaption className={`${hand.className} py-1 text-center text-3xl text-[#1A0A26]`}>
              Sent
            </figcaption>
          </figure>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
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
      </div>
    );
  } else {
    content = (
      <div>
        <h1 className="text-4xl font-extrabold">Eyes on the big screen.</h1>
        <p className="mt-3 text-lg text-[#FBF8F2]/75">
          {myPhoto ? "Your photo is in the mix." : "You'll be in the next round."}
        </p>
      </div>
    );
  }

  return (
    <main className={`${display.className} min-h-dvh bg-[#2E1046] px-6 py-12 text-[#FBF8F2]`}>
      <div className="mx-auto flex max-w-md flex-col gap-6">
        {content}
        {error && (
          <p role="alert" className="rounded-xl bg-[#FF5C8A] px-4 py-3 font-semibold text-[#1A0A26]">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
