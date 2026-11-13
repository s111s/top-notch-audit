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

## Try it in 2 minutes (no install)

1. **Open** https://s111s.github.io/top-notch-audit/
   **You should see** the published audit of `alpha-bot-demo.near`: a **Qualified opinion**, 8 trades tested, 7 tickmarked ✓, 1 finding.
2. **Look at the finding.**
   **You should see** *"Allowed tokens (trade 5): wNEAR → RHEA"*. RHEA is not on the agent's allowlist. Click the tx link: the swap is on NearBlocks, and the *intents* link shows its settlement on NEAR Intents.
3. **Check the mandate can't have been changed after the fact.**
   **You should see** in *Mandate the agent published* the rules, the mandate hash and the block it was published at, before the first trade. The hash is computed by the contract itself from the text: `near view top-notch.near get_mandates '{"agent":"alpha-bot-demo.near"}'`.
4. **Check the report is genuine.**
   **You should see** under *Verify this report yourself* two green ticks: your browser recomputed the report hash and found the same hash stored on `top-notch.near`. CLI: `near view top-notch.near get_reports '{"agent":"alpha-bot-demo.near"}'`.
5. **Re-run the audit live.** Press **Audit**.
   **You should see** the progress log, then the same opinion, computed in your browser from mainnet data (NearBlocks index, NEAR RPC, 1Click status API). No server of ours is involved.
6. **Audit any other account.** Type an account that never published a mandate, e.g. `root.near`.
   **You should see** a **Disclaimer of opinion**: no mandate, so nothing to test against. We don't guess.

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

- **NEAR Intents / 1Click API**: the demo agent trades through it (with a 0.2% app fee to `top-notch.near`), and the auditor confirms every swap's settlement through its status API.
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

Agent builders pay per audit to earn a **Top Notch verified** badge, because a verified track record wins user deposits. Next: continuous audits by subscription, and the badge in NEAR's Agent Market. The demo agent also shows a second line: a 0.2% 1Click app fee on trades routed through Top Notch tooling.

## Limits (honest)

- Evidence today covers swaps an agent makes by depositing to 1Click addresses from its own NEAR account. Other venues are out of scope and are not counted, not guessed.
- Slippage is measured as filled vs quoted output; USD values come from 1Click's own quote and settlement data.
- The TEE signature and attestation are stored and shown; full in-browser verification of the attestation is on the roadmap.
- Not financial advice and not a statutory audit.

## Roadmap

Test of controls (rely on on-chain guards such as function-call keys, the way real audits rely on internal controls), continuous monitoring, Chain Signatures for agents on other chains, Agent Market badge.
