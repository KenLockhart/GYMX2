// The Leaderboard's header art: a gold GYMX2 trophy between laurel branches, over lime light
// streaks. Drawn as vector art so it stays sharp at any size. Decorative only.

// Leaves along a laurel branch: positions on a curve from the bottom up, alternating sides.
function laurelLeaves(side: 1 | -1) {
  const leaves: { x: number; y: number; angle: number; size: number }[] = [];
  const count = 9;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // A curve that bows outward, then leans in toward the cup at the top.
    const x =
      160 + side * (102 + 30 * Math.sin(Math.PI * (0.15 + 0.7 * t)) - 22 * t);
    const y = 186 - 150 * t;
    const lean = side * (-28 + 42 * t);
    const size = 1 - 0.35 * t;
    leaves.push({ x: x - side * 9 * size, y, angle: lean - side * 48, size });
    if (i > 0)
      leaves.push({
        x: x + side * 9 * size,
        y: y + 4,
        angle: lean + side * 42,
        size: size * 0.92,
      });
  }
  return leaves;
}

function Branch({ side }: { side: 1 | -1 }) {
  const leaves = laurelLeaves(side);
  const stem = Array.from({ length: 20 }, (_, i) => {
    const t = i / 19;
    const x =
      160 + side * (102 + 30 * Math.sin(Math.PI * (0.15 + 0.7 * t)) - 22 * t);
    return `${i ? "L" : "M"}${x.toFixed(1)},${(190 - 150 * t).toFixed(1)}`;
  }).join(" ");
  return (
    <g>
      <path
        d={stem}
        fill="none"
        stroke="url(#tr-leaf)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {leaves.map((leaf, i) => (
        <g
          key={i}
          transform={`translate(${leaf.x.toFixed(1)} ${leaf.y.toFixed(1)}) rotate(${leaf.angle.toFixed(1)}) scale(${leaf.size.toFixed(2)})`}
        >
          <path
            d="M0,-15 C8,-9 8,9 0,15 C-8,9 -8,-9 0,-15 Z"
            fill="url(#tr-leaf)"
          />
          <path
            d="M0,-12 L0,12"
            stroke="#7a5512"
            strokeOpacity="0.45"
            strokeWidth="0.8"
          />
        </g>
      ))}
    </g>
  );
}

// Position it with className (absolute or relative); the layers inside are placed against it.
export function TrophyArt({ className = "relative" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none overflow-hidden ${className}`}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(115deg, transparent 0%, transparent 38%, rgba(60,110,10,0.55) 38%, rgba(60,110,10,0.55) 52%, rgba(120,190,20,0.7) 52%, rgba(120,190,20,0.7) 63%, rgba(200,241,53,0.9) 63%, rgba(200,241,53,0.9) 70%, rgba(150,210,30,0.75) 70%), radial-gradient(70% 90% at 55% 45%, rgba(110,170,20,0.55), transparent 70%), linear-gradient(90deg, #0b0d09 0%, #16260a 45%, #2d5a0a 100%)",
          maskImage: "linear-gradient(90deg, transparent 0%, black 30%)",
          WebkitMaskImage: "linear-gradient(90deg, transparent 0%, black 30%)",
        }}
      />
      <svg
        viewBox="0 0 320 200"
        className="relative h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="tr-gold" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#6b4a0e" />
            <stop offset="0.18" stopColor="#c99a2e" />
            <stop offset="0.38" stopColor="#ffeaa0" />
            <stop offset="0.52" stopColor="#e7bb4c" />
            <stop offset="0.78" stopColor="#a7771c" />
            <stop offset="1" stopColor="#4d3407" />
          </linearGradient>
          <linearGradient id="tr-gold-v" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff1b8" />
            <stop offset="0.5" stopColor="#d6a63c" />
            <stop offset="1" stopColor="#6b4a0e" />
          </linearGradient>
          <linearGradient id="tr-leaf" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#fbe7a6" />
            <stop offset="0.55" stopColor="#d9ad55" />
            <stop offset="1" stopColor="#9c6c22" />
          </linearGradient>
          <radialGradient id="tr-glow">
            <stop offset="0" stopColor="#c8f135" stopOpacity="0.55" />
            <stop offset="1" stopColor="#c8f135" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="tr-shine" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        <ellipse cx="160" cy="95" rx="120" ry="90" fill="url(#tr-glow)" />
        <Branch side={-1} />
        <Branch side={1} />

        {/* Handles */}
        <path
          d="M108,48 C70,46 66,92 104,104 C112,107 118,112 120,118"
          fill="none"
          stroke="url(#tr-gold-v)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M212,48 C250,46 254,92 216,104 C208,107 202,112 200,118"
          fill="none"
          stroke="url(#tr-gold-v)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M108,48 C70,46 66,92 104,104"
          fill="none"
          stroke="#fff3c4"
          strokeOpacity="0.5"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Bowl */}
        <path
          d="M98,40 L222,40 C222,96 202,128 174,138 L146,138 C118,128 98,96 98,40 Z"
          fill="url(#tr-gold)"
        />
        <path
          d="M112,46 C112,92 124,118 142,130"
          fill="none"
          stroke="url(#tr-shine)"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.7"
        />
        <ellipse cx="160" cy="40" rx="62" ry="9" fill="#f6d77a" />
        <ellipse cx="160" cy="40.5" rx="56" ry="6.5" fill="#7c5612" />

        {/* Badge */}
        <ellipse
          cx="160"
          cy="84"
          rx="44"
          ry="22"
          fill="#0c0d0b"
          stroke="#2a2a22"
          strokeWidth="1.5"
        />
        <text
          x="160"
          y="92"
          textAnchor="middle"
          style={{
            fontFamily:
              "var(--font-display), 'Barlow Condensed', 'Arial Narrow', sans-serif",
          }}
          fontWeight="800"
          fontSize="24"
          textLength="74"
          lengthAdjust="spacingAndGlyphs"
          letterSpacing="0.5"
        >
          <tspan fill="#f4f4ef">GYM</tspan>
          <tspan fill="#c8f135">X2</tspan>
        </text>

        {/* Stem and base */}
        <path d="M150,138 L170,138 L166,156 L154,156 Z" fill="url(#tr-gold)" />
        <ellipse cx="160" cy="157" rx="14" ry="4" fill="#e9c25a" />
        <path d="M144,160 L176,160 L182,176 L138,176 Z" fill="url(#tr-gold)" />
        <rect
          x="128"
          y="176"
          width="64"
          height="12"
          rx="2"
          fill="url(#tr-gold)"
        />
        <rect
          x="128"
          y="176"
          width="64"
          height="2.5"
          fill="#fff0b0"
          opacity="0.6"
        />
      </svg>
    </div>
  );
}
