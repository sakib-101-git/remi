// Drives the UI through Demo_Video_Script.md and records a silent 1440x900 capture. Usage: node e2e/record_demo.mjs <baseUrl> <outFile.webm>
import { chromium } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const base = process.argv[2] ?? "http://localhost:8767";
const outFile = process.argv[3] ?? new URL("../../evidence/demo_raw.webm", import.meta.url).pathname;
const videoDir = mkdtempSync(join(tmpdir(), "remi-video-"));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
const pause = (ms = 1500) => page.waitForTimeout(ms);
const panel = () => page.getByTestId("chat-panel").locator(".overflow-y-auto");
const ask = async (text) => {
  if (!(await page.getByTestId("chat-panel").count())) await page.getByTestId("nav-chat").click();
  await page.getByTestId("chat-input").pressSequentially(text, { delay: 22 });
  await pause(400);
  await page.getByTestId("chat-send").click();
  await page.getByTestId("chat-working").waitFor({ state: "detached", timeout: 90000 }).catch(() => {});
  await pause(2500);
};
const scrollChat = async () => { await panel().evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })); await pause(2000); };
const closeChat = async () => { if (await page.getByTestId("chat-panel").count()) await page.getByLabel("Close chat").click(); await pause(600); };
const nav = async (route) => { await closeChat(); await page.getByTestId(`nav-${route}`).click(); await pause(3000); };

async function flow() {
  await page.goto(base + "/#/");
  await pause(3500);
  await page.getByTestId("landing-cta").click();
  await page.getByTestId("onboarding").waitFor();
  await pause(2000);
  await page.getByTestId("consent-accept").click();
  await page.getByTestId("total-balance").waitFor();
  await pause(3500);

  await page.getByTestId("pay-tuition").click();
  await page.getByTestId("action-card").last().waitFor({ timeout: 90000 });
  await pause(3000);
  await scrollChat();
  await page.getByTestId("confirm-btn").last().click();
  await page.getByTestId("receipt").last().waitFor();
  await scrollChat();
  await page.getByTestId("receipt").last().locator('[data-step="settled"][data-state="done"]').waitFor({ timeout: 30000 });
  await pause(2500);

  await nav("insights");
  await nav("credit");

  await ask("Tell me when GBP/BDT is better than 163.5, then convert 500 GBP");
  await closeChat();
  await page.getByTestId("nav-sandbox").click();
  await pause(1500);
  await page.getByTestId("sb-shock").click();
  await page.getByTestId("toast-rate_alert").waitFor({ timeout: 15000 });
  await page.keyboard.press("Escape");
  await page.getByTestId("nav-home").click();
  await page.getByTestId("review-approval").first().waitFor();
  await pause(2000);
  await page.getByTestId("review-approval").first().click();
  await pause(1500);
  const sheetCard = page.getByRole("dialog").getByTestId("action-card");
  const reissue = sheetCard.getByTestId("reissue-btn");
  if (await reissue.count()) { await reissue.click(); await pause(800); }
  await sheetCard.getByTestId("confirm-btn").click();
  await pause(3000);
  await page.keyboard.press("Escape");

  await page.getByTestId("nav-sandbox").click();
  await pause(1000);
  await page.getByTestId("sb-invoice").click();
  await pause(1200);
  await page.getByTestId("sb-review").click();
  await page.getByTestId("fraud-card").last().waitFor({ timeout: 90000 });
  await scrollChat();
  await pause(2000);

  await ask("Send 700,000 BDT to my dad with Alpha Remit. If it's over the limit just split it into smaller payments.");
  await scrollChat();
  await page.getByTestId("confirm-btn").last().click();
  await page.getByTestId("otp-code").waitFor();
  await pause(2000);
  const code = (await page.getByTestId("otp-code").innerText()).trim();
  await page.getByTestId("otp-input").last().pressSequentially(code, { delay: 120 });
  await page.getByTestId("verify-btn").last().click();
  await page.getByTestId("receipt").last().waitFor();
  await page.getByLabel("Close phone").click().catch(() => {});
  await scrollChat();

  await ask("What documents do I usually need to pay tuition from abroad?");
  await page.getByTestId("source-chip").last().click();
  await page.getByTestId("kb-article").waitFor();
  await pause(3500);
  await page.keyboard.press("Escape");

  await nav("security");
  await page.getByTestId("verify-log").click();
  await page.getByTestId("chain-status").scrollIntoViewIfNeeded();
  await pause(3500);
  await page.getByTestId("nav-home").click();
  await pause(2500);
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
