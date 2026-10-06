// Minimal outline camera centred in the heart (about a quarter of its
// width): rounded body, round lens, small viewfinder bump on top
const CAMERA = (
  <g strokeLinecap="round">
    <path d="M10.6 9.9 11 9.1h2l.4.8" />
    <rect x="9.3" y="9.9" width="5.4" height="3.7" rx="0.9" />
    <circle cx="12" cy="11.75" r="1.1" />
  </g>
);

// Thin outline heart, optionally with the camera inside. Never filled.
export function Heart({
  className = "",
  strokeWidth = 1.5,
  camera = false,
}: {
  className?: string;
  strokeWidth?: number;
  camera?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M12 20.5s-7.5-4.6-9.3-9.4C1.4 7.6 3.6 4 7.1 4c2.1 0 3.6 1.2 4.9 3 1.3-1.8 2.8-3 4.9-3 3.5 0 5.7 3.6 4.4 7.1-1.8 4.8-9.3 9.4-9.3 9.4z" />
      {camera && CAMERA}
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.18em] font-bold tracking-tight ${className}`}>
      PicMe
      <Heart className="h-[0.62em] w-[0.62em] text-rose" strokeWidth={2} />
    </span>
  );
}

// One large, very faint heart behind the page
export function HeartWatermark() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-1 overflow-hidden">
      <Heart
        className="absolute left-1/2 top-1/2 h-[min(110vw,110vh)] w-[min(110vw,110vh)] -translate-x-1/2 -translate-y-1/2 text-rose opacity-[0.07]"
        strokeWidth={0.35}
        camera
      />
    </div>
  );
}
