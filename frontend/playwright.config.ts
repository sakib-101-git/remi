import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 8765);
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: process.env.E2E_REPORT ?? "../evidence/playwright_results.json" }]],
  use: { baseURL: external ?? `http://localhost:${PORT}`, viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  webServer: external
    ? undefined
    : {
        command: `rm -rf .e2e-data && DATA_DIR=.e2e-data LLM_PROVIDER=mock LLM_FALLBACK=mock LLM_CACHE=off DEMO_SETTLE_SECONDS=3 KB_USE_EMBEDDINGS=false ../backend/.venv/bin/uvicorn app.main:app --app-dir ../backend --port ${PORT}`,
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
