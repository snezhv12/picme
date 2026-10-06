import { useEffect, useRef } from "react";
import { tick } from "@/app/game-actions";
import { secondsLeft, useNow } from "./useNow";

// Seconds left until `deadline` (server time), or null without one. When it
// reaches zero this device asks the server to move the game on: after a
// small random delay (so not every phone at once), then every few seconds
// until the game has moved on (for up to a minute).
export function useDeadline(deadline: string | null | undefined, onMoved?: () => void) {
  const now = useNow(!!deadline);
  const left = secondsLeft(deadline, now);
  const onMovedRef = useRef(onMoved);
  useEffect(() => {
    onMovedRef.current = onMoved;
  });

  const due = left === 0;
  useEffect(() => {
    if (!deadline || !due) return;
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = async () => {
      tries += 1;
      await tick().catch(() => null);
      if (!alive) return;
      onMovedRef.current?.();
      // Give up after a minute; another device (or a reload) will try again
      if (tries < 12) timer = setTimeout(attempt, 5000);
    };
    timer = setTimeout(attempt, 300 + Math.random() * 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [deadline, due]);

  return left;
}
