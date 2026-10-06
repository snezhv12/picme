"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

// The uploader's optional written story, after the reveal. Mount with
// key={photo.id} so the draft resets for each photo.
export function StoryEditor({
  photoId,
  playerId,
  story,
  onSaved,
}: {
  photoId: string;
  playerId: string;
  story: string | null;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState(story ?? "");
  const [editing, setEditing] = useState(!story);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("set_story", {
      p_photo: photoId,
      p_player: playerId,
      p_story: draft,
    });
    setBusy(false);
    if (error) {
      setError("Couldn't save. Try again.");
      return;
    }
    setEditing(false);
    onSaved?.();
  }

  const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`glass w-full rounded-full px-6 py-3 text-base font-semibold ${focus}`}
      >
        {story ? "Edit your story" : "Write your story"}
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="text-base font-semibold">
          Tell us the story <span className="font-normal text-ink/65">(one word or a whole novel, up to you)</span>
        </span>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          maxLength={4000}
          className="glass rounded-2xl px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-rose"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className={`flex-1 rounded-full bg-rose px-6 py-3 text-base font-semibold text-white disabled:opacity-40 ${focus}`}
        >
          {busy ? "Saving…" : "Save story"}
        </button>
        {story !== null && (
          <button
            type="button"
            onClick={() => {
              setDraft(story ?? "");
              setEditing(false);
            }}
            className={`glass rounded-full px-5 py-3 text-base font-semibold ${focus}`}
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-sm font-semibold">{error}</p>}
    </form>
  );
}
