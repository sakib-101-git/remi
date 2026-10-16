---
title: "How Remi's safety tiers work"
region: global
last_reviewed: 2026-10-15
illustrative: false
---

# How Remi's safety tiers work

## Permission tiers
Every action Remi can take has a permission tier:
- T0 Read: balances, quotes, rates, insights and knowledge search. Automatic and logged.
- T1 Low-risk write: budgets, alerts, reminders and drafts. Automatic, logged, and reversible.
- T2 Money movement: conversions between your wallets and payments to verified recipients within limits. Remi prepares an action card; nothing happens until you confirm it.
- T3 High risk: new payees, large amounts, first-time corridors or high risk scores. You confirm and then enter a one-time code; new payees also have a cooling-off period.
- T4 Governance: changing limits or permissions, disabling alerts or touching the audit log. Remi can never do these; only you can, in Settings, with step-up verification.

## Confirmation tokens
When Remi proposes a payment, the server creates a single-use confirmation token bound to the exact details of that payment. It expires after five minutes. The AI never sees it, so it cannot approve anything by itself.

## Audit trail
Every action is recorded in an append-only log where each entry includes the hash of the previous one. Anyone can verify the chain; tampering breaks it.

## Kill switch
You can pause Remi's ability to propose money movements at any time from Settings.
