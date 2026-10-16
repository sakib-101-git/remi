## Real-model notes (Gemini free tier, 16 Oct 2026)

Model: `gemini-3.5-flash-lite` through Gemini's OpenAI-compatible endpoint, free tier, `--sleep 6` between turns and a 20 s back-off before retrying a failed call. In a real-model run, **every LLM-answered turn must come from that model**: a turn that silently fell back to the mock agent fails the check `answered by gemini (no mock fallback)`. S10 and S12 are answered by deterministic guardrails before any LLM call, by design.

How we got from the first real-model run to 13/13 (each fix is covered by a test):

| Run | Result | What failed | Fix |
|---|---|---|---|
| 1 | 0/1 (S1 only) | Gemini 3 rejected tool-call follow-ups: missing `thought_signature` | Provider-specific `extra_content` is now carried back with each tool call (`agent/llm.py`, `orchestrator._call_message`) |
| 2 | 9/13 | S2 quoted GBP→GBP (model omitted the source currency); S6 alert direction already met; S8/S9 the model asked "would you like me to propose…?" instead of proposing | Quotes without a payee default to the home-currency wallet; alerts that would fire immediately are rejected; prompt states that proposing moves nothing (the card is where the user decides); beneficiary output explains cooling-off scheduling |
| 3 | 11/13 | S6 converted immediately for a conditional request; S8 suggested a *smaller amount* to fit the provider limit | Prompt rule for conditional requests; quote output forbids shrinking or splitting amounts; temperature 0 |
| 4 | 12/13 | S13 answer lacked the "illustrative" disclaimer | Deterministic disclaimer appended when illustrative KB articles are used |
| 5 | **13/13** | – | Clean run on the final code with an empty cache; recorded into `evals/replay_cache.json` |

The replay run serves the recorded Gemini answers (`(cache)` in "Answered by") against fresh workspaces with new random ids. It caught one more bug: a replayed `invoice_id` from the recording workspace. Invoice ids are now accepted only when they belong to the caller's workspace (`payments.own_invoice`), and otherwise the payee's open invoice is used.

Recording the demo video in one long session (where the replay cache misses) exposed one more gap. Gemini skipped `analyze_document` and went straight to a tuition proposal. That was safe, because it used the registry account and was blocked for balance, but no fraud warning was shown. **Document review is now deterministic**: every attachment is analysed by code before the model runs, and a suspected fraud removes the money-moving tools for that turn (`test_attachment_is_reviewed_deterministically_and_fraud_removes_money_tools`). FX "shock" ticks are now exact moves (no random noise on top), so S6 and the demo button are reproducible. A clean re-recording on that code (empty cache) passed **11/13**. S2 had one turn fall back to the mock after repeated Gemini `503` errors, which the no-fallback check correctly failed. S8 routed correctly but did not *say* it won't split the payment. An explicit split request now always gets a deterministic refusal sentence (`guardrails.add_split_refusal`, tested). S2 and S8 were then re-run live: both pass, giving the 13/13 above. Every other scenario's result comes from the clean re-recording.

Free-tier caveats: Gemini returned occasional `503 high demand` errors; the retry absorbed them. Live latency is dominated by the free tier (median ≈ 18–25 s per turn across runs, including several tool calls), which is why the public demo serves recorded answers first.
