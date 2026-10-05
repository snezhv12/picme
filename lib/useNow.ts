import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Difference between the server clock and this device's clock, so every
// device counts down to the same moment
let offset = 0;
let syncing: Promise<void> | null = null;

function syncClock() {
  syncing ??= (async () => {
    const sent = Date.now();
    const { data } = await supabase.rpc("server_time");
    const received = Date.now();
    if (data) offset = new Date(data).getTime() - (sent + received) / 2;
  })();
  return syncing;
}

// Current server time that re-renders while `active` (for countdowns)
export function useNow(active: boolean, ms = 200) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!active) return;
    syncClock();
    const t = setInterval(() => setNow(Date.now() + offset), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

export function secondsLeft(endsAt: string | null | undefined, now: number) {
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 1000));
}
