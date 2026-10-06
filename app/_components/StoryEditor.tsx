"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

// The uploader's optional story. Saved as they type; before the reveal it's
// kept secret (the server never sends it back), so the draft also lives on
// this phone. Mount with key={photo.id}.

const SECRET_KEY = "picme-secret"; // proves to the server this phone wrote the story
const draftKey = (photoId: string) => `picme-story-${photoId}`;

function secret() {
  try {
    let s = localStorage.getItem(SECRET_KEY);
    if (!s) {
      s =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(SECRET_KEY, s);
    }
    return s;
  } catch {
    return "";
  }
}

function readDraft(photoId: string) {
  try {
    return localStorage.getItem(draftKey(photoId));
  } catch {
    return null;
  }
}

type Status = "idle" | "saving" | "saved" | "error";

export function StoryEditor({
  photoId,
  playerId,
  revealed,
  published,
}: {
  photoId: string;
  playerId: string;
  // Has this photo's uploader been revealed (story visible to everyone)?
  revealed: boolean;
  // The story everyone can see after the reveal, if any
  published?: string | null;
}) {
  const [text, setText] = useState(() => readDraft(photoId) ?? published ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(text);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function save(value: string) {
    setStatus("saving");
    const { error } = await supabase.rpc("set_story", {
      p_photo: photoId,
      p_player: playerId,
      p_secret: secret(),
      p_story: value,
    });
    if (latest.current !== value) return; // newer typing will save again
    if (error) {
      setStatus("error");
      setErrorText(
        error.message.includes("another device")
          ? "This story was started on another phone, so it can only be changed there."
          : "Couldn't save. Keep typing to try again."
      );
    } else {
      setStatus("saved");
    }
  }

  function change(value: string) {
    setText(value);
    latest.current = value;
    try {
      localStorage.setItem(draftKey(photoId), value);
    } catch {}
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(value), 700);
  }

  return (
    <label className="flex flex-col gap-2">
      <span className="text-base font-semibold">
        Tell us the story <span className="font-normal text-ink/65">(one word or a whole novel, up to you)</span>
      </span>
      <textarea
        value={text}
        onChange={(e) => change(e.target.value)}
        rows={3}
        maxLength={4000}
        placeholder="Optional"
        className="glass rounded-2xl px-4 py-3 text-lg outline-none placeholder:text-ink/40 focus:ring-2 focus:ring-rose"
      />
      <span className="flex min-h-5 justify-between gap-3 text-sm text-ink/65">
        <span>{revealed ? "Everyone can see it now." : "Only you can see it until your photo is revealed."}</span>
        <span aria-live="polite" className="shrink-0 font-semibold">
          {status === "saving" && "Saving…"}
          {status === "saved" && "Saved"}
        </span>
      </span>
      {status === "error" && (
        <span role="alert" className="text-sm font-semibold">
          {errorText}
        </span>
      )}
    </label>
  );
}
