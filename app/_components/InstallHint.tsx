"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Small, dismissible "add PicMe to your home screen" tip for the join
// screen. Only for iPhone Safari and Android Chrome, and never once PicMe
// already runs from the home screen.

const DISMISSED_KEY = "picme-install-hint-dismissed";
type Platform = "ios" | "android" | null;

const noSubscribe = () => () => {};

function detect(): Platform {
  try {
    if (localStorage.getItem(DISMISSED_KEY)) return null;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return null;
    const ua = navigator.userAgent;
    const ios = /iPhone|iPod/.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return "ios";
    if (/Android/.test(ua) && /Chrome\//.test(ua) && !/EdgA|OPR|SamsungBrowser|Firefox/.test(ua)) {
      return "android";
    }
  } catch {}
  return null;
}

// Chrome's own install prompt, when it offers one
type InstallPrompt = Event & { prompt: () => Promise<void> };

export function InstallHint() {
  const platform = useSyncExternalStore(noSubscribe, detect, () => null);
  const [dismissed, setDismissed] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!platform || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {}
  }

  async function install() {
    await installPrompt?.prompt();
    dismiss();
  }

  return (
    <aside className="glass flex items-start gap-3 rounded-2xl px-4 py-3 text-sm" aria-label="Add PicMe to your home screen">
      <p className="flex-1 leading-snug">
        <span className="font-semibold">Tip: add PicMe to your home screen</span>
        <br />
        {platform === "ios" ? (
          <>
            Tap the <span className="font-semibold">Share</span> button, then{" "}
            <span className="font-semibold">Add to Home Screen</span>.
          </>
        ) : installPrompt ? (
          <>
            <button onClick={install} className="font-semibold text-ink underline underline-offset-2">
              Install PicMe
            </button>{" "}
            to open it full screen.
          </>
        ) : (
          <>
            Tap the <span className="font-semibold">⋮</span> menu, then{" "}
            <span className="font-semibold">Add to Home screen</span> or{" "}
            <span className="font-semibold">Install app</span>.
          </>
        )}
      </p>
      <button
        onClick={dismiss}
        aria-label="Hide this tip"
        className="-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink/50 hover:bg-white/80 focus-visible:outline-2 focus-visible:outline-ink"
      >
        ✕
      </button>
    </aside>
  );
}
