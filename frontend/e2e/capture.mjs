// Captures every key screen and chat card for the docs and deck into evidence/screenshots/.
// Usage: node e2e/capture.mjs [baseUrl]   (desktop 1440x900 and mobile 390x844, 2x pixel density)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:8765";
const out = new URL("../../evidence/screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const shot = async (name, opts = {}) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}${name}.png`, ...opts }); console.log("saved", name); };
const chatBottom = () => page.getByTestId("chat-panel").locator(".overflow-y-auto").evaluate((el) => el.scrollTo(0, el.scrollHeight));
const ask = async (text, attachment) => {
  if (!(await page.getByTestId("chat-panel").count())) await page.getByTestId("nav-chat").click();
  if (attachment) {
    await page.getByLabel("Attach document").click();
    await page.getByTestId("attach-text").fill(attachment);
    await page.getByTestId("attach-confirm").click();
  }
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
  await page.getByTestId("chat-working").waitFor({ state: "detached", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(600);
};
const closeChat = async () => { if (await page.getByTestId("chat-panel").count()) await page.getByLabel("Close chat").click(); };
const go = async (route) => { await closeChat(); await page.goto(`${base}/#/${route}`); await page.waitForTimeout(1200); };

await page.goto(base + "/#/");
await page.getByTestId("live-quote").getByText("University receives").waitFor();
await shot("01_landing");
await shot("01b_landing_full", { fullPage: true });

await page.goto(base + "/#/home");
await page.getByTestId("onboarding").waitFor();
await shot("02_onboarding");
await page.getByTestId("consent-accept").click();
await page.getByTestId("total-balance").waitFor();
await shot("03_home");

await go("send");
await page.getByTestId("quotes-card").waitFor();
await page.getByTestId("quotes-compare").getByRole("button").click();
await shot("04_send");

await go("home");
await page.getByTestId("pay-tuition").click();
await page.getByTestId("action-card").last().waitFor({ timeout: 90000 });
await shot("05_chat_s1_review");
await page.getByTestId("confirm-btn").last().click();
await page.getByTestId("receipt").last().waitFor();
await page.waitForTimeout(14000);
await chatBottom();
await shot("06_chat_s1_tracking");

await go("insights");
await shot("07_insights");
await go("credit");
await shot("08_credit");
await go("wallets");
await shot("09_wallets");
await go("security");
await shot("10_security");
await page.getByTestId("verify-log").click();
await page.getByTestId("chain-status").scrollIntoViewIfNeeded();
await shot("11_activity_log");

await go("home");
await ask("Tell me when GBP/BDT is better than 163.5, then convert 500 GBP");
await closeChat();
await page.getByTestId("nav-sandbox").click();
await shot("12_demo_controls");
await page.getByTestId("sb-shock").click();
await page.getByTestId("toast-rate_alert").waitFor({ timeout: 15000 });
await page.keyboard.press("Escape");
await page.getByTestId("review-approval").first().waitFor();
await shot("13_rate_alert");

await page.getByTestId("nav-sandbox").click();
await page.getByTestId("sb-invoice").click();
await page.waitForTimeout(500);
await page.getByTestId("sb-review").click();
await page.getByTestId("fraud-card").last().waitFor({ timeout: 90000 });
await shot("14_fraud_block");

await ask("Send 700,000 BDT to my dad with Alpha Remit. If it's over the limit just split it into smaller payments.");
await page.getByTestId("confirm-btn").last().click();
await page.getByTestId("otp-code").waitFor();
await chatBottom();
await shot("15_stepup_code");
const code = (await page.getByTestId("otp-code").innerText()).trim();
await page.getByTestId("otp-input").last().fill(code);
await page.getByTestId("verify-btn").last().click();
await page.getByTestId("receipt").last().waitFor();
await page.getByLabel("Close phone").click().catch(() => {});

await ask("What documents do I usually need to pay tuition from abroad?");
await page.getByTestId("source-chip").last().click();
await page.getByTestId("kb-article").waitFor();
await shot("16_help_answer");
await page.keyboard.press("Escape");
await closeChat();

await go("styleguide");
await shot("17_styleguide", { fullPage: true });

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, storageState: await ctx.storageState() });
const m = await mobile.newPage();
for (const [name, route] of [["m01_landing", ""], ["m02_home", "home"], ["m03_send", "send"], ["m04_insights", "insights"], ["m05_security", "security"]]) {
  await m.goto(`${base}/#/${route}`);
  await m.waitForTimeout(1500);
  await m.screenshot({ path: `${out}${name}.png` });
  console.log("saved", name);
}
await m.goto(`${base}/#/home`);
await m.getByTestId("tab-chat").click();
await m.waitForTimeout(1200);
await m.screenshot({ path: `${out}m06_chat.png` });
console.log("saved m06_chat");
await browser.close();
