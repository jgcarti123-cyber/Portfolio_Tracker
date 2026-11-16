"use client";

import qrcode from "qrcode-generator";

/** The QR modules for a text: true = dark. */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** A QR code drawn as one SVG path, dark on a white quiet zone so any phone camera reads it. */
export function Qr({ text, size = 180, label }: { text: string; size?: number; label: string }) {
  const m = qrModules(text);
  const n = m.length;
  const pad = 3;
  let d = "";
  m.forEach((row, r) => row.forEach((on, c) => on && (d += `M${c + pad} ${r + pad}h1v1h-1z`)));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n + pad * 2} ${n + pad * 2}`} role="img" aria-label={label} className="block rounded-xl" shapeRendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" />
      <path d={d} fill="#0b0c0f" />
    </svg>
  );
}
