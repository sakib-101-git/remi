import { expect, test } from "@playwright/test";

// S1 end to end through the real UI: ask → best option → approval card (T2) → confirm → tracking until arrived → activity log verified.
test("S1: pay £9,250 tuition end to end", async ({ page }) => {
  await page.goto("/#/home");
  await page.getByTestId("consent-accept").click();
  await expect(page.getByTestId("total-balance")).toContainText("£");

  await page.getByTestId("nav-chat").click();
  await page.getByTestId("chat-input").fill("Pay my £9,250 tuition before the deadline, cheapest safe way");
  await page.getByTestId("chat-send").click();

  const quotes = page.getByTestId("quotes-card").last();
  await expect(quotes).toContainText("Campus Pay");
  await expect(quotes).toContainText("Recommended");
  await quotes.getByTestId("quotes-compare").getByRole("button").click();
  await expect(quotes).toContainText("Not eligible");

  const card = page.getByTestId("action-card").last();
  await expect(card).toContainText("£9,250.00");
  await expect(card).toContainText("T2");
  await expect(card.getByTestId("action-status")).toHaveText("Needs your approval");
  await expect(page.getByTestId("assistant-message").last()).toContainText("Nothing has moved yet");

  await card.getByTestId("confirm-btn").click();
  const receipt = card.getByTestId("receipt");
  await expect(receipt).toContainText("RMI-");
  await expect(card.getByTestId("action-status")).toHaveText("Done");
  await expect(receipt).toHaveAttribute("data-transfer-status", "settled", { timeout: 30_000 });
  await expect(receipt.locator('[data-step="settled"]')).toHaveAttribute("data-state", "done");

  await page.getByLabel("Close chat").click();
  await page.getByTestId("nav-security").click();
  await expect(page.getByTestId("chain-status")).toContainText("Log verified");
});
