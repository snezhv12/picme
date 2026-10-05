// Sound + browser notification on the host when someone asks to join.
// Browsers only allow sound after the page has been clicked once, and
// notifications only after the host said yes (asked from a button).

let audio: AudioContext | null = null;

// Call from a click: creates/resumes the audio so later chimes can play,
// even with the tab in the background
export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") audio.resume();
  } catch {}
}

// Short, soft two-note chime
export function chime() {
  if (!audio || audio.state !== "running") return;
  const start = audio.currentTime + 0.02;
  [659.25, 880].forEach((freq, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    const t = start + i * 0.14;
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  });
}

export type NotifyPermission = NotificationPermission | "unsupported";

// Notifications need https (or localhost); on plain http they're unsupported
export function notifyPermission(): NotifyPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export async function askNotifyPermission() {
  if (typeof Notification === "undefined") return;
  try {
    await Notification.requestPermission();
  } catch {}
}

export function notifyJoin(name: string, id: string) {
  if (notifyPermission() !== "granted") return;
  try {
    const n = new Notification(`${name} wants to join PicMe`, {
      body: "Let them in on the host screen.",
      tag: `picme-join-${id}`,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {}
}
