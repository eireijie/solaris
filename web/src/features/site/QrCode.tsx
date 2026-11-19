import { useMemo } from "react";
import { qrMatrix } from "../../lib/qr";

/**
 * Crisp SVG QR code. Dark modules on a white quiet zone (4 modules) so phone cameras
 * read it reliably on a projector; `shape-rendering: crispEdges` keeps module edges sharp.
 */
export function QrCode({ value, label, className = "" }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => qrMatrix(value, "M"), [value]);
  const q = 4;
  const total = size + q * 2;
  return (
    <svg
      className={`site-qr ${className}`}
      viewBox={`0 0 ${total} ${total}`}
      role="img"
      aria-label={label}
      data-qr-text={value}
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#ffffff" rx={1.2} />
      <path d={path} transform={`translate(${q} ${q})`} fill="#05070b" />
    </svg>
  );
}
