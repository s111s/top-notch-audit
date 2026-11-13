# Top Notch ✓

**Audit opinions for AI trading agents on NEAR.**
In auditing, a notch (✓) marks every item that was checked. A top notch is the clean opinion every agent wants.

> Built at NEAR HACKATHON 2026. Tracks: agents, security, business.

20+ teams at this hackathon built locks that stop AI agents from overspending. Locks don't tell you whether an agent follows its own rules. In finance, trust comes from audited evidence. Top Notch tests every trade an agent actually made on NEAR mainnet against the mandate the agent published on-chain, then issues an audit opinion whose hash is stored on-chain.

| Opinion | Meaning |
|---|---|
| ✅ Clean | Every tested trade followed the mandate |
| ⚠️ Qualified | Breaches, but below the materiality threshold |
| ❌ Adverse | Material breaches |
| ❔ Disclaimer | No valid mandate or no trades: not enough evidence to judge |

---

## Try it in 60 seconds (no wallet, no install)

1. **Open** https://s111s.github.io/top-notch-audit/
   **You should see** the published audit of `alpha-bot-demo.near`: a **Qualified opinion**, 8 trades tested, 7 tickmarked ✓, 1 finding.
2. **Look at the finding.**
   **You should see** *"Allowed tokens (trade 5): wNEAR → RHEA"*. RHEA is not on the agent's allowlist. Click the tx link to see the swap on NearBlocks, and *intents* to see its settlement on NEAR Intents.
3. **Check the report is genuine.** Scroll to *Verify this report yourself*.
   **You should see** two green ticks: your browser recomputed the report hash and found the same hash stored on `top-notch.near`.
4. **Re-run the audit live.** Press **Audit**.
   **You should see** a progress log (23 transactions read, 8 confirmed as 1Click swaps), then the same opinion, computed in your browser from mainnet data. No server of ours is involved.
5. **Watch the live tape.** Click **Live tape** (or open https://s111s.github.io/top-notch-audit/live.html).
   **You should see** every agent that published a mandate, its live opinion, and every trade it made, newest first, each tickmarked ✓ or flagged ✗. It refreshes every 30 seconds; new trades flash in.
6. **Audit any other account.** Type e.g. `root.near` and press **Audit**.
   **You should see** a **Disclaimer of opinion**: no mandate was published, so there is nothing to test against. We don't guess.

## Go deeper (optional)

**Check the chain directly (NEAR CLI, read-only, no wallet):**

```bash
near view top-notch.near get_mandates '{"agent":"alpha-bot-demo.near"}'   # the mandate text + on-chain hash
near view top-notch.near get_reports  '{"agent":"alpha-bot-demo.near"}'   # opinion + report hash
```

**Audit from the command line:**

```bash
git clone https://github.com/s111s/top-notch-audit && cd top-notch-audit && npm install
node scripts/auditor.mjs alpha-bot-demo.near --no-publish --no-letter
```

**Audit your own agent (needs a NEAR mainnet account):** anyone can publish a mandate, because the registry records whoever calls it as the agent.

```bash
near call top-notch.near publish_mandate '{"mandate":"{\"version\":1,\"allowed_assets\":[\"nep141:wrap.near\",\"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1\"],\"max_trade_usd\":5,\"max_slippage_bps\":100}"}' --accountId YOUR_AGENT.near
```

Then make a swap from that account through 1Click (e.g. `node scripts/agent.mjs trade wNEAR USDC 0.3` with your key in `TN_KEY_DIR`), open the page, type `YOUR_AGENT.near` and press **Audit**.

## Key mainnet evidence

| What | Link |
|---|---|
| Registry contract | [`top-notch.near`](https://nearblocks.io/address/top-notch.near) |
| Demo agent | [`alpha-bot-demo.near`](https://nearblocks.io/address/alpha-bot-demo.near) |
| Registry deployed | [`GbzosWHLf3…`](https://nearblocks.io/txns/GbzosWHLf3mKEgVNhrkewu98UPTx1KqRKedhGr6rLYwX) |
| Mandate published by the agent | [`6YcbGSCq6B…`](https://nearblocks.io/txns/6YcbGSCq6BwMhjey6CZmQCUoHgwgRhLmixHf3PBWV5kK) |
| The breach (trade 5: wNEAR → RHEA) | [`7mbn36C8SR…`](https://nearblocks.io/txns/7mbn36C8SR47PBqKZW6T5xSSPciVnRf3AaBopdS8rN6d) |
| Report published (Qualified, hash `473c6a29…`) | [`9sHWBD1KDm…`](https://nearblocks.io/txns/9sHWBD1KDmxEDJU9EmMHJMTw2om2T7Ga5hswzqUSvAXK) |
| NEAR AI Cloud signing address | `0xfe0071895500a9755c18044948ab4f4e1a7f337e` |

## How it works

```
alpha-bot-demo.near ──publish_mandate(text)──▶ top-notch.near   (hash computed on-chain)
alpha-bot-demo.near ──ft_transfer to 1Click deposit address──▶ NEAR Intents swap
Top Notch engine (web/engine.js, browser or Node):
  1. read the mandate from top-notch.near (view call), re-hash it
  2. list the agent's transactions (NearBlocks), read each from NEAR RPC
  3. keep deposits to one-time addresses that 1Click confirms as swaps (/v0/status)
  4. test each trade: allowlist, max size, requested + realised slippage, settled;
     then daily rules: max trades per day, max daily loss
  5. findings + materiality → opinion                     ← deterministic code
  6. canonical JSON → sha256 → publish_report on top-notch.near (auditor only)
  7. NEAR AI Cloud (TEE) writes the opinion letter and signs it; it cannot change the opinion
```

### The mandate (stored on-chain, in full)

```json
{
  "version": 1,
  "agent": "alpha-bot-demo.near",
  "allowed_assets": ["nep141:wrap.near", "nep141:17208628…a1 (USDC)"],
  "max_trade_usd": 2.5,
  "max_slippage_bps": 100,
  "max_trades_per_day": 12,
  "max_daily_loss_usd": 1,
  "materiality": { "adverse_if_findings_at_least": 3, "material_usd": 10 }
}
```

### Registry contract (`contract/`)

Append-only. `publish_mandate(mandate)` must be called by the agent account itself, so the link agent ↔ mandate is signed by the agent; the contract computes the sha256. `publish_report(...)` only accepts calls from the auditor, and refuses any opinion other than *disclaimer* if the mandate hash wasn't published by that agent. Nothing can be edited or deleted.

## NEAR tech used

- **NEAR Intents / 1Click API**: the demo agent trades through it (every trade carries an app fee tag to `top-notch.near`: 0.1% today, 0.2% with a 1Click partner key), and the auditor confirms every swap's settlement through its status API.
- **NEAR smart contract** (Rust, near-sdk 5): mandate and report registry.
- **NEAR AI Cloud**: TEE-run model writes and signs the opinion letter (signature + attestation saved with the report).
- **Named accounts**: readable reports, e.g. `alpha-bot-demo.near: Qualified`.

## Run locally

```bash
git clone https://github.com/s111s/top-notch-audit && cd top-notch-audit
npm install
# Serve the page (static, no build step)
npx http-server web -p 8080      # open http://localhost:8080
# Audit from the command line without publishing
node scripts/auditor.mjs alpha-bot-demo.near --no-publish --no-letter
# Contract tests
cd contract && cargo test
```

`scripts/setup.mjs` (create accounts, deploy), `scripts/agent.mjs` (publish mandate, trade) and `scripts/auditor.mjs` (audit, publish, letter) need funded keys in `TN_KEY_DIR`; they're how the demo was produced.

## Business model

Agent builders pay per audit to earn a **Top Notch verified** badge, because a verified track record wins user deposits. Next: continuous audits by subscription, and the badge in NEAR's Agent Market. Second line: agents that trade through Top Notch's open tooling carry a 1Click app fee tag to `top-notch.near` (0.1% today), which is also how their flow shows up on the live tape.

## Limits (honest)

- Evidence today covers swaps an agent makes by depositing to 1Click addresses from its own NEAR account. Other venues are out of scope and are not counted, not guessed.
- Slippage is measured as filled vs quoted output; USD values come from 1Click's own quote and settlement data.
- The TEE signature and attestation are stored and shown; full in-browser verification of the attestation is on the roadmap.
- Not financial advice and not a statutory audit.

## Roadmap

Test of controls (rely on on-chain guards such as function-call keys, the way real audits rely on internal controls), continuous monitoring, Chain Signatures for agents on other chains, Agent Market badge.
