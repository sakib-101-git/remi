// Drives the UI through Demo_Video_Script.md and records a silent 1440x900 capture. Usage: node e2e/record_demo.mjs <baseUrl> <outFile.webm>
import { chromium } from "@playwright/test";
import { mkdtempSync, copyFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const base = process.argv[2] ?? "http://localhost:8767";
const outFile = process.argv[3] ?? new URL("../../evidence/demo_raw.webm", import.meta.url).pathname;
const videoDir = mkdtempSync(join(tmpdir(), "remi-video-"));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
const pause = (ms = 1500) => page.waitForTimeout(ms);
const say = async (text, attachment) => {
  await page.getByTestId("nav-chat").click();
  if (attachment) {
    await page.getByLabel("Attach document").click();
    await page.getByTestId("attach-text").fill(attachment);
    await page.getByTestId("attach-confirm").click();
  }
  await page.getByTestId("chat-input").pressSequentially(text, { delay: 25 });
  await pause(500);
  await page.getByTestId("chat-send").click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="chat-send"] .animate-spin'), null, { timeout: 90000 });
  await pause(2500);
};
const show = async (selector) => { await page.locator(selector).last().scrollIntoViewIfNeeded(); await pause(2500); };

async function flow() {
  await page.goto(base + "/#/dashboard");
  await page.getByTestId("onboarding").waitFor();
  await pause();
  await page.getByTestId("consent-checkbox").check();
  await page.getByTestId("consent-accept").click();
  await page.getByTestId("total-balance").waitFor();
  await pause(4000);

  await say("Pay my £9,250 tuition before the deadline, cheapest safe way");
  await show('[data-testid="quotes-card"]');
  await show('[data-testid="action-card"]');
  await page.getByTestId("confirm-btn").last().click();
  await page.getByTestId("receipt").last().waitFor();
  await show('[data-testid="receipt"]');
  await pause(10000);

  await say("How am I doing this month? How long will my money last?");
  await say("I just arrived in the UK and have no credit history");

  await say("Tell me when GBP/BDT is better than 163.5, then convert 500 GBP");
  await page.getByTestId("nav-sandbox").click();
  await pause();
  await page.getByTestId("sb-shock").click();
  await page.getByTestId("toast-rate_alert").waitFor({ timeout: 15000 });
  await pause(2000);
  await page.getByTestId("nav-dashboard").click();
  const alertCard = page.getByTestId("action-card").first();
  await alertCard.waitFor();
  await pause(2000);
  const review = alertCard.getByRole("button", { name: /Review & approve|Re-check/ });
  if (await review.count()) { await review.click(); await pause(1000); }
  await alertCard.getByTestId("confirm-btn").click();
  await pause(3000);

  await page.getByTestId("nav-sandbox").click();
  await page.getByTestId("sb-invoice").click();
  await pause();
  await page.getByTestId("sb-review").click();
  await page.getByTestId("fraud-card").last().waitFor({ timeout: 60000 });
  await show('[data-testid="fraud-card"]');

  await say("Send 700,000 BDT to my dad with Alpha Remit. If it's over the limit just split it into smaller payments.");
  await show('[data-testid="action-card"]');
  await page.getByTestId("confirm-btn").last().click();
  await page.getByTestId("otp-code").first().waitFor();
  await pause(2000);
  const code = (await page.getByTestId("otp-code").first().innerText()).trim();
  await page.getByTestId("otp-input").last().pressSequentially(code, { delay: 120 });
  await page.getByTestId("verify-btn").last().click();
  await page.getByTestId("receipt").last().waitFor();
  await pause(2000);
  const close = page.getByLabel("Close phone");
  if (await close.count()) await close.click();

  await say("What documents do I usually need to pay tuition from abroad?");
  await page.getByTestId("source-chip").last().click();
  await page.getByTestId("kb-article").waitFor();
  await pause(3500);
  await page.keyboard.press("Escape");

  await page.getByTestId("nav-audit").click();
  await page.getByTestId("chain-status").waitFor();
  await pause(1000);
  await page.getByRole("button", { name: "Verify chain" }).click();
  await pause(3000);
  await page.getByTestId("nav-dashboard").click();
  await pause(3000);
}

try {
  await flow();
} catch (e) {
  console.error(e);
  await page.screenshot({ path: outFile.replace(/\.webm$/, "_failure.png") }).catch(() => {});
  await browser.close();
  process.exit(2);
}

const video = page.video();
await ctx.close();
await browser.close();
mkdirSync(dirname(outFile), { recursive: true });
copyFileSync(await video.path(), outFile);
rmSync(videoDir, { recursive: true, force: true });
console.log("saved", outFile);
