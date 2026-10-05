// One burst of confetti that falls once and stays gone (hidden for people who
// prefer reduced motion). Positions are spread by a fixed formula, so the
// server and browser render the same thing.
const COLORS = ["#c2185b", "#2a0e1f", "#ff8fb4", "#ffd23f", "#fff4f8", "#7b1fa2"];

export function Confetti({ pieces = 90 }: { pieces?: number }) {
  return (
    <div aria-hidden className="confetti pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {Array.from({ length: pieces }, (_, i) => {
        const left = (i * 37) % 100;
        const delay = ((i * 53) % 100) / 100;
        const duration = 2.6 + ((i * 29) % 100) / 60;
        const size = 8 + ((i * 17) % 9);
        const drift = ((i * 41) % 120) - 60;
        return (
          <span
            key={i}
            className="confetti-piece"
            style={{
              left: `${left}%`,
              width: size,
              height: size * 0.45,
              background: COLORS[i % COLORS.length],
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              ["--drift" as string]: `${drift}px`,
            }}
          />
        );
      })}
    </div>
  );
}
