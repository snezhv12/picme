"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

// Quick picks under each photo; "+" opens the phone's keyboard for any emoji
export const QUICK_REACTIONS = ["❤️‍🩹", "😂", "🤭", "💪🏻", "💅", "🐐", "😮‍💨"];

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

// First emoji in some typed text (what the "+" field accepts)
function firstEmoji(text: string) {
  const segments =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment)
      : Array.from(text);
  return segments.find((g) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(g)) ?? null;
}

// Phone: "Send a reaction" + a row of emoji. Tap another to switch, the same
// one again to take it back.
export function ReactionPicker({
  mine,
  onPick,
  disabled,
}: {
  mine: string | null;
  onPick: (emoji: string) => void;
  disabled?: boolean;
}) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const custom = mine && !QUICK_REACTIONS.includes(mine) ? mine : null;

  function take(value: string) {
    const e = firstEmoji(value);
    if (e) {
      onPick(e);
      setText("");
      setTyping(false);
    } else {
      setText(value);
    }
  }

  const item = (on: boolean) =>
    `grid h-11 min-w-11 place-items-center rounded-full px-1 text-2xl leading-none transition active:scale-95 disabled:opacity-40 ${focus} ${
      on ? "border border-rose bg-rose/25 ring-2 ring-rose" : "glass"
    }`;

  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-ink/60">Send a reaction</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Send a reaction">
        {QUICK_REACTIONS.map((e) => (
          <button
            key={e}
            onClick={() => onPick(e)}
            disabled={disabled}
            aria-pressed={mine === e}
            className={item(mine === e)}
          >
            {e}
          </button>
        ))}
        {custom && (
          <button onClick={() => onPick(custom)} disabled={disabled} aria-pressed className={item(true)}>
            {custom}
          </button>
        )}
        <button
          onClick={() => {
            setTyping(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          disabled={disabled}
          aria-label="Another emoji"
          className={`${item(false)} text-xl font-semibold`}
        >
          +
        </button>
      </div>
      {typing && (
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => take(e.target.value)}
          onBlur={() => !text && setTyping(false)}
          placeholder="Pick any emoji from your keyboard"
          aria-label="Any emoji"
          enterKeyHint="send"
          className="glass mt-2 w-full rounded-full px-5 py-3 text-lg outline-none focus:ring-2 focus:ring-rose"
        />
      )}
    </div>
  );
}

// Bubbles with counts, e.g. 😂 3. Before the reveal they're only counts;
// after it, tapping shows who reacted with what.
export function ReactionBubbles({
  photoId,
  counts,
  canShowNames,
  size = "sm",
}: {
  photoId: string;
  counts: Record<string, number> | null | undefined;
  canShowNames: boolean;
  size?: "sm" | "lg";
}) {
  const [people, setPeople] = useState<{ name: string; emoji: string }[] | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const entries = Object.entries(counts ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;

  // Names shown for this photo only; a new photo starts closed
  const open = canShowNames && openFor === photoId && people;

  async function toggle() {
    if (!canShowNames) return;
    if (open) {
      setOpenFor(null);
      return;
    }
    const { data } = await supabase.rpc("reaction_people", { p_photo: photoId });
    setPeople((data as { name: string; emoji: string }[] | null) ?? []);
    setOpenFor(photoId);
  }

  const bubble = size === "lg" ? "px-4 py-1.5 text-2xl" : "px-3 py-1 text-base";
  const Wrapper = canShowNames ? "button" : "div";

  return (
    <div className="flex flex-col items-center gap-2">
      <Wrapper
        {...(canShowNames
          ? { onClick: toggle, "aria-expanded": !!open, "aria-label": "Show who reacted", className: `rounded-full ${focus}` }
          : {})}
      >
        <span className="flex flex-wrap justify-center gap-2">
          {entries.map(([emoji, n]) => (
            <span key={emoji} className={`glass inline-flex items-center gap-1.5 rounded-full font-semibold tabular-nums ${bubble}`}>
              <span aria-hidden>{emoji}</span>
              {n}
              <span className="sr-only">{` reacted with ${emoji}`}</span>
            </span>
          ))}
        </span>
      </Wrapper>
      {open && (
        <ul className={`glass flex flex-wrap justify-center gap-x-4 gap-y-1 rounded-2xl px-4 py-2 ${size === "lg" ? "text-xl" : "text-sm"}`}>
          {people.length === 0 && <li>No reactions</li>}
          {people.map((p, i) => (
            <li key={i}>
              {p.emoji} {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
