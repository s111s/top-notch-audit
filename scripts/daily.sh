#!/usr/bin/env bash
# The daily cycle, run after each daily candle closes (00:20 UTC):
# prices -> researcher signals -> managed agent rebalances the vault -> audits -> data for the site.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/fetch-prices.mjs 365
node scripts/researcher.mjs signal dip-in-uptrend
node scripts/researcher.mjs signal trend-5-20
node scripts/researcher.mjs signal eco-reversal
node scripts/researcher.mjs curve dip-in-uptrend
node scripts/researcher.mjs curve trend-5-20
node scripts/researcher.mjs curve eco-reversal
node scripts/managed-agent.mjs run
node scripts/strategy-audit.mjs dip-in-uptrend
node scripts/strategy-audit.mjs trend-5-20
node scripts/strategy-audit.mjs eco-reversal
node scripts/auditor.mjs alpha-bot-demo.near
