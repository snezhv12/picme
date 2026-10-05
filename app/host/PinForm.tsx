"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/app/_components/Heart";
import { unlock } from "./actions";

export default function PinForm() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  // Count down while too many wrong tries make us wait
  useEffect(() => {
    if (!waitUntil) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= waitUntil) setWaitUntil(null);
    }, 250);
    return () => clearInterval(t);
  }, [waitUntil]);
  const wait = waitUntil ? Math.max(0, Math.ceil((waitUntil - now) / 1000)) : 0;

  async function submit() {
    if (!pin.trim() || busy || wait > 0) return;
    setBusy(true);
    setError(null);
    const res = await unlock(pin);
    setBusy(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    setPin("");
    setError(res.error);
    if (res.waitSeconds) {
      setNow(Date.now());
      setWaitUntil(Date.now() + res.waitSeconds * 1000);
    }
  }

  const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink";

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-10">
      <form
        className="glass flex w-full max-w-md flex-col gap-6 rounded-[2rem] p-8"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Logo className="text-4xl" />
        <label className="flex flex-col gap-2">
          <span className="text-xl font-semibold">Host PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            maxLength={64}
            className="glass rounded-full px-6 py-4 text-2xl tracking-[0.3em] outline-none focus:ring-2 focus:ring-rose"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !pin.trim() || wait > 0}
          className={`rounded-full bg-rose px-8 py-4 text-xl font-semibold text-white shadow-[0_10px_30px_rgb(232_120_154/0.35)] disabled:opacity-40 disabled:shadow-none ${focus}`}
        >
          {busy ? "Checking…" : wait > 0 ? `Try again in ${wait}s` : "Unlock"}
        </button>
        {error && (
          <p role="alert" className="text-lg font-semibold">
            {error}
            {wait > 0 && ` Wait ${wait} seconds.`}
          </p>
        )}
      </form>
    </main>
  );
}
