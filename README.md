# Top Notch ✓

**A strategy marketplace for NEAR, with an auditor built in.**
Researchers publish trading strategies with honest backtests, and they can keep the logic hidden. Investors pick a strategy and run their **own** agent on it through NEAR Intents, paying the researcher a fee in every swap. An independent auditor checks both sides on-chain.

> Built at NEAR HACKATHON 2026. Tracks: defi, agents, business.

## Who it is for

| | Researcher (quant, trader, student) | Investor (has capital) |
|---|---|---|
| **Job to be done** | "I have a trading idea. I want to test it on real data in minutes and get paid if it's good, without running money myself or giving my logic away." | "I want strategies with a track record I can trust, run from my own wallet." |
| **Pain today** | Building data and backtest code takes days. A good idea earns nothing without capital. Sharing it means it gets copied. | Signal groups sell screenshots. Copy-trading means handing funds or keys to someone. |
| **What Top Notch gives** | A browser Lab with BRAIN-style stats (Sharpe, drawdown, turnover, fitness) on NEAR Intents prices. Publish public or hidden; earn bps on every follower swap. | Audited stats. Hidden logic proven to match its commitment. An agent that trades only your wallet, audited against the strategy's scope. |

**Business model:** every follower swap goes through 1Click with `appFees`: the researcher's fee (here 20 bps) and a platform fee (5 bps) are paid by the swap itself. No custody, no pooled fund, no invoices. Auditing (strategy certification and agent audits) is the trust layer that makes hidden strategies sellable.

**Why NEAR:** NEAR Intents gives one execution path and one fee rail across chains; the registry contract timestamps every strategy card and signal so nobody can backdate a track record; NEAR AI Cloud signs the audit letters inside a TEE.

---

## Try it in 60 seconds (no wallet, no install)

1. **Open** https://s111s.github.io/top-notch-audit/
   **You should see** two strategies read live from `top-notch.near` on mainnet: *Dip in an uptrend* (🔒 hidden, 5/5 gates, auditor **Clean**) and *Majors trend 5/20* (public, 4/5 gates: it fails out-of-sample), plus one investor agent, `alpha-bot-demo.near`, following the hidden one.
2. **Click "Dip in an uptrend".**
   **You should see** the backtest (Sharpe 2.78, max drawdown −8.9%, fitness 16.45) against holding NEAR, the logic shown only as a sha256 commitment, the auditor's four checks all ✓ (logic matches commitment, stats reproduced, every signal reproduced, no backdating) and a letter signed by NEAR AI Cloud.
3. **Open the Lab** and pick any example, or write your own, e.g. `rank(ts_mean(returns, 14)) - 0.5`.
   **You should see** stats, an equity curve, in-sample vs out-of-sample, the listing gates, and tomorrow's target weights, computed in your browser.
4. **Open Agent audit** (`alpha-bot-demo.near`).
   **You should see** a **Clean** opinion on the investor agent: 2 mainnet swaps, each tickmarked for *Signal in force*, *Trades toward the signal* and *Researcher paid: 20 bps to researcher-1.top-notch.near*. Press **Audit** to recompute it in your browser from chain data.

## Mainnet evidence

| What | Where |
|---|---|
| Registry + auditor | `top-notch.near` |
| Researcher account | `researcher-1.top-notch.near` (created in tx `384wwYAgQ2pzEpTdjopeFRvDsaN6DmaqTiDNSsMpYkem`) |
| Hidden strategy card | tx `BRWkEmquD3RUJjNyxR8DxZZmNWnC78FJiE5irkLERucr` |
| Public strategy card | tx `4Qps2Luftv99VkdsKkHHJbMPW4efwxw1MtmfrM62RoWr` |
| Signals (2026-11-12 candle) | txs `4zeqfkCokrfX8qCfjfzL8pyMhL9gMQHaMDoSBP8kUHeW`, `5PNuzc8RpaCiNsppGQUSdEytoa9fVS2bNxUHQGrWe5jj` |
| Investor follow mandate | tx `FUyJoJeKSQrXEMe8ar9m3xacKWawGqHnCC7ApuTgEAm7` |
| Follower swaps via 1Click (researcher fee inside) | txs `HSkQ7tRhzamiCZSxHnBkJfmCs5c9paXJ8QuZM5Nxs2Q5`, `278mFTwXRVn3QE4Zp9vsuu7S6gNJL48EzmjU53e8NvvE` |
| Strategy audit reports | txs `FqzHpJUDeWUzzqcXU4FT3UTXRu7rwBohP4mM3KVn6zt9` (hidden), `DFbkHfh7deLNoYxm82ppEYks5vBnpkvo8U1iqekLAPRs` (public) |
| Investor agent audit report | tx `AX1jWnFDgLhpKmcNDwPBbXCvK5scffujdTDPikVsipRW` |

## How hidden logic works

1. The researcher publishes a **card**: name, settings, universe, stats, fee, and `logic_commit = sha256(expression | settings | salt)`. The expression and salt stay private.
2. Every day the researcher's account publishes a **signal** (target weights) computed from the last complete daily candle, naming the sha256 of the exact price snapshot it used.
3. Under engagement the **auditor** receives the expression and salt, and checks: the commitment matches, the backtest reproduces the claimed stats, every on-chain signal is reproduced exactly, and no signal was published before its candle closed. Code decides the opinion; NEAR AI Cloud only writes and signs the letter, and the letter is rejected if it changes the opinion.
4. Investors see the stats, the signals and the opinion, never the logic. (Roadmap: run the signal computation in a TEE so even the auditor needn't see it.)

## How investor agents are audited

The agent publishes a `follow` mandate (strategy, card hash, max trade size, max slippage, max signal age, researcher fee). The audit engine reads every swap the agent signed on mainnet, its 1Click settlement, and the strategy's signals, then tickmarks each trade: allowed token, size, slippage, settled, **signal in force**, **trades toward the signal**, **researcher paid**.

## Run it yourself

```bash
npm ci
export NODE_USE_ENV_PROXY=1            # only behind a proxy
node scripts/fetch-prices.mjs          # 6 months of daily prices from NEAR Intents pools (GeckoTerminal)
node scripts/researcher.mjs preview dip-in-uptrend   # needs the private logic file for hidden strategies
node scripts/researcher.mjs preview trend-5-20       # public: works for anyone
node scripts/strategy-audit.mjs trend-5-20 --no-publish --no-letter
node scripts/auditor.mjs alpha-bot-demo.near --no-publish --no-letter
python3 -m http.server -d web 8000     # then open http://localhost:8000
```

Publishing (`researcher.mjs publish|signal`, `follow.mjs mandate|rebalance`, the audits without `--no-publish`) needs the account keys, which are not in this repo.

## Files

- `web/alpha.js`: expression language (`ts_mean`, `ts_delta`, `rank`, `ts_zscore`…), long-only backtester, stats, gates, logic commitment.
- `web/engine.js`: agent audit engine (mainnet tx evidence, 1Click settlement, follow-mandate checks).
- `web/market.js`: reads cards, signals, reports and followers from the registry.
- `web/index.html` strategies · `web/strategy.html` one strategy · `web/lab.html` Lab · `web/audit.html` agent audit · `web/live.html` live trade tape.
- `scripts/`: price fetcher, researcher, investor follow agent, strategy audit, agent audit, NEAR AI Cloud letter.
- `contract/`: the append-only registry (`publish_mandate`, `publish_report`).

## Honest limits

- About 6 months of daily data on 10 liquid tokens: stats are noisy and overfitting is easy. That's why the out-of-sample column and the gates are shown everywhere.
- Long-only (swaps can't short), so many alphas are partly NEAR beta. Every curve is shown against holding NEAR.
- 1Click without a partner key records half of each requested app fee and adds its own, so the agent requests 2× the agreed bps and the audit checks the recorded amount.
- Demo sizes are tiny ($1–$5 swaps) on purpose.
