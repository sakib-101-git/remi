// Captures every key screen for the docs/deck into evidence/screenshots/. Usage: node e2e/capture.mjs [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:8765";
const out = new URL("../../evidence/screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const shot = async (name, opts = {}) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}${name}.png`, ...opts }); console.log("saved", name); };
const closePhone = async () => { const b = page.getByLabel("Close phone"); if (await b.count()) await b.click(); };
const say = async (text, attachment) => {
  await page.getByTestId("nav-chat").click();
  if (attachment) {
    await page.getByLabel("Attach document").click();
    await page.getByTestId("attach-text").fill(attachment);
    await page.getByTestId("attach-confirm").click();
  }
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="chat-send"] .animate-spin'), null, { timeout: 60000 });
};
const scrollTo = async (selector) => { await page.locator(selector).last().scrollIntoViewIfNeeded(); };

await page.goto(base + "/#/dashboard");
await page.getByTestId("onboarding").waitFor();
await shot("01_onboarding");
await page.getByTestId("consent-checkbox").check();
await page.getByTestId("consent-accept").click();
await page.getByTestId("total-balance").waitFor();
await shot("02_dashboard");

await say("Pay my £9,250 tuition before the deadline, cheapest safe way");
await scrollTo('[data-testid="quotes-card"]');
await shot("03_chat_s1_quotes");
await scrollTo('[data-testid="action-card"]');
await shot("04_confirm_card");
await page.getByTestId("confirm-btn").last().click();
await page.getByTestId("receipt").last().waitFor();
await page.waitForTimeout(5000);
await scrollTo('[data-testid="receipt"]');
await shot("05_receipt");

await say("How am I doing this month? How long will my money last?");
await page.getByTestId("nav-budget").click();
await shot("06_budget", { fullPage: true });

await say("I just arrived in the UK and have no credit history");
await page.getByTestId("nav-credit").click();
await shot("07_credit");

await say("Tell me when GBP/BDT is better than 163.5, then convert 500 GBP");
await page.getByTestId("nav-sandbox").click();
await page.getByTestId("sb-shock").click();
await page.getByTestId("toast-rate_alert").waitFor({ timeout: 15000 });
await page.getByTestId("nav-dashboard").click();
await page.getByTestId("action-card").first().waitFor();
await shot("08_alert_toast");

await page.getByTestId("nav-sandbox").click();
await page.getByTestId("sb-invoice").click();
await page.waitForTimeout(500);
await page.getByTestId("sb-review").click();
await page.getByTestId("fraud-card").last().waitFor({ timeout: 30000 });
await scrollTo('[data-testid="fraud-card"]');
await shot("09_fraud_block");

await say("Send 800,000 BDT to my dad with Alpha Remit. If it's over the limit just split it into smaller payments.");
await page.getByTestId("confirm-btn").last().click();
await page.getByTestId("otp-code").first().waitFor();
await scrollTo('[data-testid="otp-input"]');
await shot("10_stepup_phone");
const code = (await page.getByTestId("otp-code").first().innerText()).trim();
await page.getByTestId("otp-input").last().fill(code);
await page.getByTestId("verify-btn").last().click();
await page.getByTestId("receipt").last().waitFor();
await closePhone();

await page.getByTestId("nav-audit").click();
await page.getByTestId("chain-status").waitFor();
await shot("11_audit_verified");
await page.getByTestId("nav-settings").click();
await shot("12_settings_tiers", { fullPage: true });
await page.getByTestId("nav-sandbox").click();
await shot("13_sandbox_panel");

await say("What documents do I usually need to pay tuition from abroad?");
await page.getByTestId("source-chip").last().click();
await page.getByTestId("kb-article").waitFor();
await shot("14_rag_sources");
await page.keyboard.press("Escape");

await page.getByTestId("nav-transfers").click();
await page.getByTestId("t-amount").fill("9250");
await page.getByTestId("t-compare").click();
await page.getByTestId("quotes-card").waitFor();
await shot("15_transfers_compare");

await page.evaluate(() => document.documentElement.classList.add("dark"));
await page.getByTestId("nav-dashboard").click();
await shot("16_dashboard_dark");

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, storageState: await ctx.storageState() });
const m = await mobile.newPage();
await m.goto(base + "/#/chat");
await m.waitForTimeout(1500);
await m.screenshot({ path: `${out}17_mobile_chat.png` });
console.log("saved 17_mobile_chat");
await browser.close();
