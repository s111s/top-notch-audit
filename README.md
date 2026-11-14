# Top Notch ✓

**A strategy marketplace with managed AI agents, built on three NEAR products.**
Researchers publish trading strategies with honest backtests, logic public or hidden. Investors pick one and fund their own vault; our managed agent trades it through NEAR Intents and can never withdraw. An auditor checks both sides, and NEAR AI Cloud signs every note and opinion.

> Built at NEAR HACKATHON 2026. Tracks: agents, defi, business.

## What NEAR makes possible here

| NEAR product | What it does in Top Notch | Why it matters |
|---|---|---|
| **NEAR Intents / 1Click** | Every trade is a 1Click swap. The researcher's fee (20 bps) and the platform's fee (10 bps) are paid *inside* the swap via `appFees`. | One API for any token, settlement in seconds, and a revenue model with no billing system. |
| **NEAR accounts + contracts** | Each investor gets a vault: a NEAR account whose only full-access key is the investor's. The vault contract lets our agent call one method, `swap`, within the owner's caps, only to a one-time Intents deposit address. It can't withdraw. | An agent can trade real money without custody. That's the trust gap NEAR says blocks agents. |
| **NEAR AI Cloud (TEE)** | Writes the investor's daily "what your agent did" note and every audit letter, with a signature and attestation from the TEE. Code decides; the model only writes, and a letter that changes the opinion is rejected. | Private, verifiable AI: investors can check the note came from the attested model, unedited. |
| **NEAR registry contract** | Timestamps strategy cards, daily signals, agent mandates and audit reports, append-only. | Track records can't be backdated, and hidden logic is pinned by a hash. |

## Who it is for

| | Researcher (quant, trader, student) | Investor (has capital) |
|---|---|---|
| **Job to be done** | "I have a trading idea. I want to test it on real data in minutes and get paid if it's good, without running money myself or giving my logic away." | "I want strategies with a track record I can trust, run from my own wallet." |
| **Pain today** | Building data and backtest code takes days. A good idea earns nothing without capital. Sharing it means it gets copied. | Signal groups sell screenshots. Copy-trading means handing funds or keys to someone. |
| **What Top Notch gives** | A browser Lab with BRAIN-style stats (Sharpe, drawdown, turnover, fitness) on NEAR Intents prices. Publish public or hidden; earn bps on every follower swap. | Audited stats. Hidden logic proven to match its commitment. A managed agent that trades your own vault, can't withdraw, sends you a signed daily note, and is audited against the strategy. |

**Business model:** every agent swap goes through 1Click with `appFees`: the researcher's fee (20 bps) and the platform's fee (10 bps) are paid by the swap itself. No custody, no pooled fund, no invoices. Later: a monthly fee for managed agents and paid strategy certification. Auditing (strategy certification and agent audits) is the trust layer that makes hidden strategies sellable.

**Why NEAR:** NEAR Intents gives one execution path and one fee rail across chains; the registry contract timestamps every strategy card and signal so nobody can backdate a track record; NEAR AI Cloud signs the audit letters inside a TEE.

---

## Try it in 60 seconds (no wallet, no install)

1. **Open** https://s111s.github.io/top-notch-audit/
   **You should see** three strategies read live from `top-notch.near` on mainnet, each with an auditor opinion: *Dip in an uptrend* (🔒 hidden, 5/5 gates), *Ecosystem 2-day reversal* (public, 4/5: fails out-of-sample, and the vault follows it) and *Majors trend 5/20* (public, 4/5), plus the managed agent `alpha-bot-demo.near` following one of them.
2. **Click "Dip in an uptrend".**
   **You should see** the backtest (Sharpe 2.78, max drawdown −8.9%, fitness 16.45) against holding NEAR, the logic shown only as a sha256 commitment, the auditor's four checks all ✓ (logic matches commitment, stats reproduced, every signal reproduced, no backdating) and a letter signed by NEAR AI Cloud.
3. **Open the Lab** and pick any example, or write your own, e.g. `rank(ts_mean(returns, 14)) - 0.5`.
   **You should see** stats, an equity curve, in-sample vs out-of-sample, the listing gates, and tomorrow's target weights, computed in your browser.
4. **Open My agent** (https://s111s.github.io/top-notch-audit/vault.html).
   **You should see** the investor's vault `vault-1.top-notch.near` holding NEAR, BTC and ETH bought by the agent, *"1 full-access key: the investor's. The platform holds none."* read live from the chain, the agent's caps, its 3 swaps with the researcher's and platform's fees inside each, a **Clean** audit, and today's note from the agent written and signed inside NEAR AI Cloud.
5. **Open Agent audit** (`alpha-bot-demo.near`).
   **You should see** the managed agent's opinion, each swap tickmarked for *Signal in force*, *Trades toward the signal*, *Through the investor's vault* and *Researcher paid*. Press **Audit** to recompute it in your browser from chain data.

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
| Investor vault created (investor key only) | deploy `DMkxzMYwEiX8QLtz3hf11rB7AEMLv8z2visn1EFbnPgV`, init `4E1zLdf1Zao9DHXRnt1WB4dZFCmKmddY6o5nVevUvpWe` |
| Investor funds vault (5.9 USDC) | tx `7ea7dAh9Z8CQtEKsg1wcMdQUWQTEzrouinA4rNTSmoa` |
| Managed agent mandate | tx `4kFTMA1pL3Vvqc1rDWToBsjnnRnorx5afHNehgKFZNKx` (then `HyQFdvB4KZMmHhbooiChofFY52HdGhTRR1eGytgAfDrE` after the switch) |
| Investor switches vault to *Ecosystem 2-day reversal* (own key) | card `6DR1xKMJhiRP2BiHuokGEw8rXd9RuZqtR9nLq8dA6tFD`, signal `Gqgg9rEPC9GLTPEMbPAy1t5c8vesJxmPCtaaBWihRPH2`, `set_policy` `AQWQFp1VvfanBtUg7YNimai2nvStH32KPNHRN2iStKuJ` |
| Agent buys from the vault via `vault.swap` + 1Click | USDC→NEAR `Dn4vZ83C3GjF7FusakZxN6tUWL9qt3sLr1kYeVGuaz3M`, USDC→BTC `9obGJAZ2F6J1ysjNcn8xAnd6Wdjd3KVXMiBAZ68FiAoB`, USDC→ETH `BZGsH6w5x4sfK5d95pBiNzxT6KLDRNHayotiHpCAM69t` |
| 1Click pays NEAR out as native NEAR, so the investor upgraded the vault (`wrap_near`, agent can wrap only, reserve kept) and the agent wrapped the position | upgrade `Hm7dcAwrmpMNrZFcnNdD2dxFKHiUM8mmGoy3UuL2UDMJ`, wrap `Ah2yc4sKcFMWhfmZzYX6TSz7kvAgj9zUqRLGmPS6GetH` |
| Audits after the switch | strategy `6eWM8cppC6wB2xiysoNBPrGfGwgb35qejHEtpVGnCWb3`, agent (Clean, 3 trades) `EKJekzjDvcj4cUpbx8ELv2XjUye4vPKszhe6nFk8MH9m` |

## How the managed agent works

1. **Onboarding.** The platform creates `vault-N.top-notch.near` with the investor's public key as its only full-access key; the investor deploys the vault contract and sets the policy: allowed tokens, per-swap caps, swaps per day, the agent, the strategy.
2. **Daily run** (`scripts/daily.sh`, scheduled by `.github/workflows/daily.yml` after each daily candle closes): the researcher's signal is published, then the agent reads it, asks 1Click for a quote with `recipient = refundTo = vault` and the fees in `appFees`, and calls `vault.swap(token, amount, deposit_address)`. The vault checks the policy and sends the tokens; output and refunds land back in the vault.
3. **Daily note.** NEAR AI Cloud writes the investor a plain-English note from the facts (signal, trades, balances) and signs it.
4. **Audit.** The auditor checks every swap the agent made: allowed token, size, slippage, settled, signal in force, toward the signal, through the vault, researcher paid.
5. **Investor controls.** Pause, change agent, change limits, withdraw: all with the investor's own key, no platform involved.

Roadmap: host the agent itself inside NEAR AI Cloud's TEE agent hosting (in invite-only beta today), so even the platform can't change what it runs.

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
- `vault/`: the investor vault contract (`swap` and `wrap_near` for the agent; `withdraw`, `withdraw_near`, `set_paused`, `set_agent`, `set_policy` for the owner), 13 unit tests: `cd vault && cargo test`.
- `scripts/vault.mjs`, `scripts/managed-agent.mjs`, `scripts/daily.sh`: onboarding, the managed agent, the daily cycle.
- `web/vault.html`: the investor's My agent page.

## Honest limits

- About 6 months of daily data on 10 liquid tokens: stats are noisy and overfitting is easy. That's why the out-of-sample column and the gates are shown everywhere.
- Long-only (swaps can't short), so many alphas are partly NEAR beta. Every curve is shown against holding NEAR.
- 1Click without a partner key records half of each requested app fee and adds its own, so the agent requests 2× the agreed bps and the audit checks the recorded amount.
- Demo sizes are tiny ($1–$5 swaps) on purpose.
- The vault can't prove a deposit address belongs to 1Click; a compromised agent could send up to one capped swap to a wrong address per call, within the daily limit. The audit flags any deposit without a 1Click settlement, and the owner can pause at once.
- The agent runs on a schedule from this repo, not yet inside a TEE.
