// Print an HTML file to an A4 PDF with page numbers. Usage: node scripts/print_pdf.mjs <in.html> <out.pdf> "<footer title>"
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [input, output, title = "Remi"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: "networkidle" }).catch(() => {});
await page.evaluate(() => document.fonts.ready);
const footer = `<div style="width:100%;font:8px Inter,Helvetica,Arial,sans-serif;color:#5b6577;padding:0 17mm;display:flex;justify-content:space-between">
  <span>${title} · Team Git Push Pray</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
await page.pdf({
  path: resolve(output), format: "A4", printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: "<div></div>", footerTemplate: footer,
  margin: { top: "18mm", bottom: "20mm", left: "17mm", right: "17mm" },
});
await browser.close();
console.log("saved", output);
