/**
 * Folio's assistant mark: a small glowing planet with a thin tilted ring, after the ringed
 * horizon in the panorama. On hover (of an ancestor with the `ai-orb-host` class) the ring
 * tips and turns, and a spark of light travels round it, passing behind the planet.
 */
export function AiOrb({ size = 20 }: { size?: number }) {
  return (
    <span className="ai-orb" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 20 20" width={size} height={size} className="ai-orb-art">
        <defs>
          <radialGradient id="ai-orb-planet" cx="36%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="38%" stopColor="#f4ecff" />
            <stop offset="72%" stopColor="#c7b5ff" />
            <stop offset="100%" stopColor="#ff9f8a" />
          </radialGradient>
          <linearGradient id="ai-orb-ring" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" />
            <stop offset="35%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="70%" stopColor="#ffd2ad" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <g className="ai-orb-tilt">
          {/* Back half of the ring, behind the planet. */}
          <path d="M0.8 10 A9.2 3.1 0 0 1 19.2 10" fill="none" stroke="url(#ai-orb-ring)" strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
          <circle cx="10" cy="10" r="4.7" fill="url(#ai-orb-planet)" className="ai-orb-planet" />
          {/* Front half, over the planet. */}
          <path d="M0.8 10 A9.2 3.1 0 0 0 19.2 10" fill="none" stroke="url(#ai-orb-ring)" strokeWidth="1.25" strokeLinecap="round" />
        </g>
      </svg>
      <span className="ai-orb-orbit">
        <span className="ai-orb-spark" />
      </span>
    </span>
  );
}
