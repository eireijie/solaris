/**
 * QR code → a single crisp SVG path (one unit per module), generated at run time from text.
 * Uses `qrcode-generator` (MIT, no dependencies).
 */
import qrcode from "qrcode-generator";

export type QrMatrix = { size: number; path: string };

export function qrMatrix(text: string, ecc: "L" | "M" | "Q" | "H" = "M"): QrMatrix {
  const qr = qrcode(0, ecc);
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      // Merge horizontal runs so the path stays small and edges stay seamless.
      let end = c;
      while (end + 1 < n && qr.isDark(r, end + 1)) end++;
      d += `M${c} ${r}h${end - c + 1}v1h-${end - c + 1}z`;
      c = end + 1;
    }
  }
  return { size: n, path: d };
}
