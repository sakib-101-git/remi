// Renders the PNG brand assets from the generated SVGs with Playwright Chromium.
// Usage: node scripts/brand_png.mjs   (run after build_brand.mjs)
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = (f) => resolve(ROOT, "public/brand", f);
const icon = readFileSync(out("remi-icon.svg"), "utf8");
const word = readFileSync(out("remi-wordmark.svg"), "utf8");
// Fonts are inlined as data URLs: a page created with setContent cannot load file:// fonts.
const dataUrl = (p) => `data:font/woff2;base64,${readFileSync(resolve(ROOT, p)).toString("base64")}`;
const bricolage = dataUrl("node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2");
const inter = dataUrl("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");

const browser = await chromium.launch();
async function render(html, w, h, file, transparent = false) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face{font-family:B;src:url(${bricolage})} @font-face{font-family:I;src:url(${inter});font-weight:100 900}
    html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${transparent ? "transparent" : "#FAF6EE"}}
    svg{display:block;width:100%;height:100%}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: transparent });
  await page.close();
  console.log("saved", file.replace(ROOT + "/", ""));
}

await render(icon, 32, 32, out("favicon-32.png"), true);
await render(icon, 180, 180, out("apple-touch-icon.png"), true);
await render(icon, 512, 512, out("icon-512.png"), true);
await render(
  `<div style="position:relative;width:1200px;height:630px;background:#FAF6EE;font-family:I">
     <div style="position:absolute;left:96px;top:150px;height:150px">${word.replace("<svg ", '<svg style="height:150px;width:auto" ')}</div>
     <div style="position:absolute;left:100px;top:350px;font:700 52px/1.15 B;color:#12201B;letter-spacing:-0.02em;max-width:900px">Money across borders, handled.</div>
     <div style="position:absolute;left:102px;top:428px;max-width:700px;font:400 26px/1.4 I;color:#5A6660">The AI money agent for international students. You approve every payment.</div>
     <div style="position:absolute;right:0;top:0;width:220px;height:630px;background:#0F3D32"></div>
     <div style="position:absolute;right:70px;bottom:70px;width:80px;height:80px;border-radius:50%;background:#FF6B3D"></div>
     <div style="position:absolute;left:102px;bottom:56px;font:500 20px I;color:#5A6660">Sandbox demo · Team Git Push Pray · FinTechathon 2026</div>
   </div>`,
  1200,
  630,
  out("og-image.png"),
);
await browser.close();
