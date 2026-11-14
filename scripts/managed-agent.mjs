// The managed agent the platform runs for an investor. Once a day:
//   1. read the strategy the vault follows and its latest on-chain signal,
//   2. rebalance the investor's vault toward it via NEAR Intents (1Click), calling vault.swap (the only power it has),
//      with the researcher's and the platform's fees inside each swap (1Click appFees),
//   3. ask NEAR AI Cloud (TEE) to write the investor's daily note and sign it.
//
// Usage:
//   node scripts/managed-agent.mjs mandate     publish the agent's follow mandate for this vault (once)
//   node scripts/managed-agent.mjs plan        show what it would do
//   node scripts/managed-agent.mjs run         rebalance + daily note
import fs from 'fs';
import { account, oneclick, sleep, REGISTRY, AGENT, USDC } from './near.mjs';
import { VAULT, INVESTOR } from './vault.mjs';
import { canonical, sha256Hex } from '../web/alpha.js';
import { writeLetter } from './letter.mjs';

const PLATFORM = { recipient: REGISTRY, bps: 10 };
const ASSETS = {
  NEAR: { id: 'nep141:wrap.near', contract: 'wrap.near', decimals: 24 },
  BTC: { id: 'nep141:nbtc.bridge.near', contract: 'nbtc.bridge.near', decimals: 8 },
  ETH: { id: 'nep141:eth.bridge.near', contract: 'eth.bridge.near', decimals: 18 },
  RHEA: { id: 'nep141:token.rhealab.near', contract: 'token.rhealab.near', decimals: 18 },
  AURORA: { id: 'nep141:aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near', contract: 'aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near', decimals: 18 },
  USDC: { id: USDC, contract: USDC.slice(7), decimals: 6 },
};
const MAX_TRADE_USD = 4.75; // stays under the vault's per-trade caps
const BAND_USD = 0.5; // ignore drifts smaller than this
const LOG = new URL('../web/data/vault-trades.json', import.meta.url);
const GAS = 100000000000000n;
const agent = await account('alpha-bot-demo');

async function entries(acct) {
  const list = await agent.viewFunction({ contractId: REGISTRY, methodName: 'get_mandates', args: { agent: acct } });
  return list.map((m) => { let j = null; try { j = JSON.parse(m.mandate); } catch {} return { ...m, json: j }; });
}
async function strategy() {
  const policy = await agent.viewFunction({ contractId: VAULT, methodName: 'get_policy' });
  const [acct, id] = policy.strategy.split('/');
  const all = await entries(acct);
  const card = all.filter((e) => e.json?.kind === 'strategy' && e.json.id === id).at(-1);
  const signal = all.filter((e) => e.json?.kind === 'signal' && e.json.id === id).at(-1);
  return { acct, id, card, signal, policy };
}

async function mandate() {
  const { acct, id, card } = await strategy();
  const universe = card.json.settings.universe;
  const m = {
    kind: 'follow', v: 1, agent: AGENT, vault: VAULT, investor: INVESTOR, managed: true,
    description: `Managed agent: trades the investor's vault ${VAULT} toward ${id} by ${acct}. It can only call vault.swap; it cannot withdraw.`,
    strategy: { account: acct, id, card_hash: card.mandate_hash },
    cash_asset: USDC,
    assets: Object.fromEntries(universe.map((s) => [s, ASSETS[s].id])),
    allowed_assets: [...universe.map((s) => ASSETS[s].id), USDC],
    max_trade_usd: 5, max_slippage_bps: 100, max_signal_age_hours: 36,
    researcher_fee_bps: card.json.fee.bps,
    materiality: { adverse_if_findings_at_least: 3, material_usd: 10 },
  };
  const r = await agent.functionCall({ contractId: REGISTRY, methodName: 'publish_mandate', args: { mandate: canonical(m) }, gas: 30000000000000n });
  console.log(`managed follow mandate published, tx ${r.transaction.hash}`);
}

const fromRaw = (raw, d) => Number(BigInt(raw)) / 10 ** d;
async function holdings(syms) {
  const prices = Object.fromEntries((await oneclick('/tokens')).map((t) => [t.assetId, t.price]));
  const out = {};
  for (const s of [...syms, 'USDC']) {
    const a = ASSETS[s];
    const raw = await agent.viewFunction({ contractId: a.contract, methodName: 'ft_balance_of', args: { account_id: VAULT } }).catch(() => '0');
    const amount = fromRaw(raw, a.decimals);
    out[s] = { raw, amount, usd: amount * (prices[a.id] || 0), price: prices[a.id] || 0 };
  }
  return out;
}

async function plan() {
  const st = await strategy();
  if (!st.signal) throw new Error('no signal yet');
  const universe = st.card.json.settings.universe;
  const h = await holdings(universe);
  const equity = Object.values(h).reduce((s, x) => s + x.usd, 0);
  const trades = [];
  const w = st.signal.json.weights;
  for (const s of universe) {
    const diff = (w[s] || 0) * equity - h[s].usd;
    if (diff < -BAND_USD) {
      const usd = Math.min(-diff, MAX_TRADE_USD);
      const all = !w[s] && -diff <= MAX_TRADE_USD;
      trades.push({ from: s, to: 'USDC', usd, raw: all ? h[s].raw : BigInt(Math.floor((usd / h[s].price) * 10 ** ASSETS[s].decimals)).toString() });
    }
  }
  for (const s of universe) {
    const diff = (w[s] || 0) * equity - h[s].usd;
    if (diff > BAND_USD) { const usd = Math.min(diff, MAX_TRADE_USD); trades.push({ from: 'USDC', to: s, usd, raw: BigInt(Math.floor(usd * 1e6)).toString() }); }
  }
  return { ...st, holdings: h, equity, trades };
}

async function ensureStorage(contract, accountId) {
  const s = await agent.viewFunction({ contractId: contract, methodName: 'storage_balance_of', args: { account_id: accountId } }).catch(() => null);
  if (s) return;
  await agent.functionCall({ contractId: contract, methodName: 'storage_deposit', args: { account_id: accountId, registration_only: true }, gas: 30000000000000n, attachedDeposit: 1250000000000000000000n });
}

async function swap(t, st) {
  const a = ASSETS[t.from], b = ASSETS[t.to];
  await ensureStorage(b.contract, VAULT);
  // 1Click without a partner key records half of each requested fee, so request 2x the agreed bps.
  const appFees = [{ recipient: st.card.json.fee.recipient, fee: st.card.json.fee.bps * 2 }, { recipient: PLATFORM.recipient, fee: PLATFORM.bps * 2 }];
  const q = await oneclick('/quote', {
    dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100,
    originAsset: a.id, depositType: 'ORIGIN_CHAIN', destinationAsset: b.id, amount: t.raw,
    refundTo: VAULT, refundType: 'ORIGIN_CHAIN', recipient: VAULT, recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 20 * 60 * 1000).toISOString(), appFees,
  });
  const dep = q.quote.depositAddress;
  console.log(`  ${t.from} -> ${t.to} $${q.quote.amountInUsd} deposit ${dep}`);
  await ensureStorage(a.contract, dep);
  // The agent's only power: ask the vault to send to the 1Click deposit address. The vault checks token, cap, day limit.
  const r = await agent.functionCall({ contractId: VAULT, methodName: 'swap', args: { token: a.contract, amount: t.raw, deposit_address: dep }, gas: GAS });
  const txHash = r.transaction.hash;
  console.log(`  vault.swap tx ${txHash}`);
  await oneclick('/deposit/submit', { txHash, depositAddress: dep }).catch(() => {});
  let status;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    status = await oneclick(`/status?depositAddress=${dep}`).catch(() => null);
    if (status && ['SUCCESS', 'REFUNDED', 'FAILED'].includes(status.status)) break;
  }
  console.log(`  status ${status?.status} out ${status?.swapDetails?.amountOutFormatted}`);
  // 1Click pays NEAR out as native NEAR; wrap it inside the vault so the position stays tradable wNEAR.
  if (t.to === 'NEAR' && status?.status === 'SUCCESS' && status.swapDetails?.amountOut) {
    const w = await agent.functionCall({ contractId: VAULT, methodName: 'wrap_near', args: { amount: status.swapDetails.amountOut }, gas: 50000000000000n });
    console.log(`  wrapped ${status.swapDetails.amountOutFormatted} NEAR inside the vault, tx ${w.transaction.hash}`);
  }
  const row = { at: new Date().toISOString(), vault: VAULT, signal_date: st.signal.json.date, signal_hash: st.signal.mandate_hash, from: t.from, to: t.to, usd: Number(q.quote.amountInUsd), txHash, depositAddress: dep, status: status?.status, amountOut: status?.swapDetails?.amountOutFormatted, appFees: q.quoteRequest.appFees };
  const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [];
  log.push(row);
  fs.writeFileSync(LOG, JSON.stringify(log, null, 2));
  return row;
}

async function dailyNote(p, done, after) {
  const facts = {
    vault: VAULT, strategy: `${p.card.json.name} (${p.id} by ${p.acct})`, signal_date: p.signal.json.date, target_weights: p.signal.json.weights,
    before: p.holdings ? Object.fromEntries(Object.entries(p.holdings).map(([k, v]) => [k, +v.usd.toFixed(2)])) : undefined,
    after: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, +v.usd.toFixed(2)])),
    trades: done.map((t) => ({ from: t.from, to: t.to, usd: +t.usd.toFixed(2), status: t.status, tx: t.txHash })),
    fees: `researcher ${p.card.json.fee.bps} bps + platform ${PLATFORM.bps} bps per swap, paid inside each 1Click swap`,
    agent_powers: 'can only call vault.swap within the owner policy; cannot withdraw',
  };
  const letter = await writeLetter({
    facts,
    system: 'You write a short daily note to an investor about what their managed trading agent did today. Use only the facts given; never invent numbers or give advice. Plain English, under 120 words, in this order: what the strategy signal asked for, what the agent did (cite each trade), where the vault stands now, and one line reminding them they can pause or withdraw at any time because the agent cannot. No markdown headers.',
    mustInclude: 'withdraw',
    attestationFile: null,
  });
  const note = { date: new Date().toISOString().slice(0, 10), facts, facts_sha256: await sha256Hex(canonical(facts)), letter };
  fs.writeFileSync(new URL(`../web/data/vault-note.json`, import.meta.url), JSON.stringify(note, null, 2));
  console.log('daily note signed by NEAR AI Cloud:', letter.signing_address);
  return note;
}

const cmd = process.argv[2];
if (cmd === 'mandate') await mandate();
else if (cmd === 'note') {
  // Rewrite today's note from today's logged trades and the vault as it stands now.
  const p = await plan();
  const today = new Date().toISOString().slice(0, 10);
  const done = (fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : []).filter((t) => t.at.startsWith(today));
  await dailyNote({ ...p, holdings: null }, done, p.holdings);
}
else if (cmd === 'wrap') { const w = await agent.functionCall({ contractId: VAULT, methodName: 'wrap_near', args: { amount: process.argv[3] }, gas: 50000000000000n }); console.log(`wrapped, tx ${w.transaction.hash}`); }
else if (cmd === 'plan' || cmd === 'run') {
  const p = await plan();
  console.log(`signal ${p.signal.json.date} ${JSON.stringify(p.signal.json.weights)} | vault equity $${p.equity.toFixed(2)}`);
  for (const [s, x] of Object.entries(p.holdings)) if (x.usd > 0.01) console.log(`  hold ${s}: ${x.amount.toFixed(6)} ($${x.usd.toFixed(2)})`);
  for (const t of p.trades) console.log(`  plan ${t.from} -> ${t.to} ~$${t.usd.toFixed(2)}`);
  if (cmd === 'run') {
    const done = [];
    for (const t of p.trades) done.push(await swap(t, p));
    const after = await holdings(p.card.json.settings.universe);
    try { await dailyNote(p, done, after); } catch (e) { console.log('note skipped:', e.message); }
  }
} else console.log('usage: managed-agent.mjs mandate | plan | run');
