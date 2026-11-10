import Image from "next/image";

// The Leaderboard's header art: the gold GYMX2 trophy. Decorative only. The edges fade out so
// the picture's black background blends into the page. Position it with className.
export function TrophyArt({ className = "relative" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none overflow-hidden ${className}`}
      style={{
        maskImage: "radial-gradient(closest-side, black 72%, transparent 100%)",
        WebkitMaskImage:
          "radial-gradient(closest-side, black 72%, transparent 100%)",
      }}
    >
      <Image
        src="/leaderboard-trophy.webp"
        alt=""
        fill
        sizes="(min-width: 1536px) 18rem, 14rem"
        className="object-cover"
        priority
      />
    </div>
  );
}
