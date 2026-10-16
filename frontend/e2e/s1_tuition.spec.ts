import { expect, test } from "@playwright/test";

// S1 end-to-end through the real UI: quotes → recommendation → confirmation card → executed → receipt → settled → audit chain verified.
test("S1: pay £9,250 tuition end to end", async ({ page }) => {
  await page.goto("/#/dashboard");
  await page.getByTestId("consent-checkbox").check();
  await page.getByTestId("consent-accept").click();
  await expect(page.getByTestId("total-balance")).toContainText("£");

  await page.getByTestId("nav-chat").click();
  await page.getByTestId("chat-input").fill("Pay my £9,250 tuition before the deadline, cheapest safe way");
  await page.getByTestId("chat-send").click();

  const quotes = page.getByTestId("quotes-card").last();
  await expect(quotes).toContainText("Campus Pay (sandbox)");
  await expect(quotes).toContainText("Recommended");
  await expect(quotes).toContainText("Not eligible");

  const card = page.getByTestId("action-card").last();
  await expect(card).toContainText("£9,250.00");
  await expect(card).toContainText("T2");
  await expect(page.getByTestId("assistant-message").last()).toContainText("Nothing has moved yet");

  await card.getByTestId("confirm-btn").click();
  const receipt = card.getByTestId("receipt");
  await expect(receipt).toContainText("RMI-");
  await expect(card).toContainText("executed");
  await expect(receipt.getByText("settled", { exact: true })).toHaveClass(/font-semibold/, { timeout: 30_000 });

  await page.getByTestId("nav-audit").click();
  await expect(page.getByTestId("chain-status")).toContainText("Chain verified");
});
