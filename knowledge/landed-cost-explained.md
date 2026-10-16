---
title: "Landed cost: the true price of a transfer"
region: global
last_reviewed: 2026-10-15
illustrative: false
---

# Landed cost: the true price of a transfer

## Why the headline fee is misleading
Providers compete on headline fees, but most of the real cost is usually hidden in the exchange rate. A provider with a zero fee and a 2% markup is more expensive than one with a small fee and a 0.4% markup on almost any meaningful amount.

## The formula Remi uses
For each provider Remi computes:
- offered rate = mid-market rate × (1 − markup)
- amount received = (amount sent − fee) × offered rate
- landed cost = amount sent − amount received ÷ mid-market rate

The landed cost is expressed in the currency you send, so you can see exactly how much of your money did not reach the recipient.

## Worked example
Suppose you send 100 GBP to Bangladesh. Provider A charges a 4 GBP fee and a 0.4% markup; Provider B charges no fee but a 2.1% markup. Provider A's landed cost is roughly 4.4 GBP; Provider B's is roughly 2.1 GBP. For 100 GBP, B wins. For 1,000 GBP, A costs about 8 GBP and B about 21 GBP, so A wins. This is why Remi always recalculates for your exact amount.

## Using it in practice
Ask Remi to compare providers for your amount and deadline. Remi shows the landed cost, the effective cost percentage, and the reason each alternative lost.
