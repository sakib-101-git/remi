// Builds the Remi brand marks as outlined SVG paths (no font needed at runtime).
// Usage: node scripts/build_brand.mjs [--variant a|b|c] [--preview]
//   writes public/brand/*.svg and src/brand/marks.ts; --preview writes .cache/brand_preview.html with all variants.
import opentype from "opentype.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT = resolve(ROOT, "node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff");
const fontBuf = readFileSync(FONT);
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

// Brand colours (mirrors src/styles/tokens.css).
const C = { primary: "#0F3D32", accent: "#FF6B3D", cream: "#FAF6EE", ink: "#12201B" };

// Dot = the "coin": radius as a fraction of the font size, and its gap above the x-height.
const VARIANTS = {
  a: { dot: 0.1, gap: 0.06, label: "A · dot 0.20em, close" },
  b: { dot: 0.115, gap: 0.1, label: "B · dot 0.23em, lifted" },
  c: { dot: 0.13, gap: 0.14, label: "C · dot 0.26em, high coin" },
};

const SIZE = 1000;
const TRACKING = -0.05 * SIZE;
const r2 = (n) => Math.round(n * 10) / 10;

function glyphPath(ch, x, baseline) {
  const g = font.charToGlyph(ch);
  const p = g.getPath(x, baseline, SIZE);
  return { d: p.toPathData(1), advance: (g.advanceWidth / font.unitsPerEm) * SIZE, box: p.getBoundingBox() };
}

function wordmark(variant) {
  const v = VARIANTS[variant];
  const baseline = SIZE;
  let x = 0;
  const parts = [];
  let iBox = null;
  for (const ch of ["r", "e", "m", "ı"]) {
    const gp = glyphPath(ch, x, baseline);
    parts.push(gp.d);
    if (ch === "ı") iBox = gp.box;
    x += gp.advance + TRACKING;
  }
  const radius = v.dot * SIZE;
  const cx = (iBox.x1 + iBox.x2) / 2;
  const cy = iBox.y1 - v.gap * SIZE - radius;
  // Bounding box over glyphs and dot.
  const all = parts.map((d) => new opentype.Path()).length;
  void all;
  const minX = 0;
  const maxX = Math.max(x - TRACKING, cx + radius);
  const top = cy - radius;
  const bottom = baseline + 0.02 * SIZE;
  const pad = 0.02 * SIZE;
  const vb = [r2(minX - pad), r2(top - pad), r2(maxX - minX + 2 * pad), r2(bottom - top + 2 * pad)];
  return { letters: parts.join(" "), dot: { cx: r2(cx), cy: r2(cy), r: r2(radius) }, viewBox: vb.join(" "), rHeight: iBox.y2 - iBox.y1 };
}

function rIcon() {
  // "r." centred on a rounded tile; the dot sits on the baseline like a full stop.
  const tile = 1000;
  const glyphSize = 760;
  const g = font.charToGlyph("r");
  const scale = glyphSize / font.unitsPerEm;
  const rW = g.advanceWidth * scale;
  const radius = 0.115 * glyphSize;
  const gapAfter = -0.005 * glyphSize;
  const total = rW + gapAfter + 2 * radius;
  const x0 = (tile - total) / 2 + 0.02 * glyphSize;
  const p0 = g.getPath(0, 0, glyphSize);
  const bb = p0.getBoundingBox();
  const baseline = tile / 2 + (bb.y2 - bb.y1) / 2 - bb.y2 + 10;
  const p = g.getPath(x0, baseline, glyphSize);
  const box = p.getBoundingBox();
  return { tile, letter: p.toPathData(1), dot: { cx: r2(box.x2 + gapAfter + radius), cy: r2(baseline - radius), r: r2(radius) } };
}

function wordmarkSvg(w, letterFill, dotFill, title = "remi") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${w.viewBox}" role="img" aria-label="${title}"><title>${title}</title><path fill="${letterFill}" d="${w.letters}"/><circle cx="${w.dot.cx}" cy="${w.dot.cy}" r="${w.dot.r}" fill="${dotFill}"/></svg>\n`;
}

function iconSvg(ic, tileFill, letterFill, dotFill) {
  const rr = Math.round(ic.tile * 0.22);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ic.tile} ${ic.tile}" role="img" aria-label="Remi"><title>Remi</title><rect width="${ic.tile}" height="${ic.tile}" rx="${rr}" fill="${tileFill}"/><path fill="${letterFill}" d="${ic.letter}"/><circle cx="${ic.dot.cx}" cy="${ic.dot.cy}" r="${ic.dot.r}" fill="${dotFill}"/></svg>\n`;
}

const args = process.argv.slice(2);
const variant = args.includes("--variant") ? args[args.indexOf("--variant") + 1] : "b";

if (args.includes("--preview")) {
  const ic = rIcon();
  const rows = Object.keys(VARIANTS).map((k) => {
    const w = wordmark(k);
    return `<section><h3>${VARIANTS[k].label}</h3>
      <div class="row cream"><div style="height:200px">${wordmarkSvg(w, C.primary, C.accent)}</div><div style="height:32px">${wordmarkSvg(w, C.primary, C.accent)}</div></div>
      <div class="row green"><div style="height:200px">${wordmarkSvg(w, C.cream, C.accent)}</div><div style="height:32px">${wordmarkSvg(w, C.cream, C.accent)}</div></div></section>`;
  }).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px Inter,sans-serif;background:#ddd}section{padding:12px}h3{margin:4px 0}
  .row{display:flex;gap:48px;align-items:center;padding:28px 40px}.row svg{height:100%;width:auto;display:block}.cream{background:${C.cream}}.green{background:${C.primary}}
  .icons{display:flex;gap:24px;align-items:end;padding:24px 40px;background:${C.cream}}.icons svg{display:block}</style>
  ${rows}<div class="icons">${[180, 64, 32, 16].map((s) => `<div style="width:${s}px;height:${s}px">${iconSvg(ic, C.primary, C.cream, C.accent)}</div>`).join("")}</div>`;
  mkdirSync(resolve(ROOT, "../.cache"), { recursive: true });
  writeFileSync(resolve(ROOT, "../.cache/brand_preview.html"), html);
  console.log("wrote .cache/brand_preview.html");
  process.exit(0);
}

const w = wordmark(variant);
const ic = rIcon();
const out = resolve(ROOT, "public/brand");
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, "remi-wordmark.svg"), wordmarkSvg(w, C.primary, C.accent));
writeFileSync(resolve(out, "remi-wordmark-reversed.svg"), wordmarkSvg(w, C.cream, C.accent));
writeFileSync(resolve(out, "remi-wordmark-mono.svg"), wordmarkSvg(w, C.ink, C.ink));
writeFileSync(resolve(out, "remi-icon.svg"), iconSvg(ic, C.primary, C.cream, C.accent));
writeFileSync(resolve(ROOT, "public/favicon.svg"), iconSvg(ic, C.primary, C.cream, C.accent));
mkdirSync(resolve(ROOT, "src/brand"), { recursive: true });
writeFileSync(
  resolve(ROOT, "src/brand/marks.ts"),
  `// Generated by scripts/build_brand.mjs (variant ${variant}). Outlined from Bricolage Grotesque ExtraBold (SIL OFL); do not edit by hand.\n` +
    `export const WORDMARK = ${JSON.stringify(w)} as const;\n` +
    `export const ICON = ${JSON.stringify(ic)} as const;\n`,
);
console.log(`brand built (variant ${variant}): public/brand/*.svg, public/favicon.svg, src/brand/marks.ts`);
