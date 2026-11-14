// The investor side. An investor runs their own agent (here alpha-bot-demo.near) that follows a strategy:
// it publishes a "follow" mandate, reads the researcher's latest on-chain signal, and rebalances its own
// wallet to the target weights through NEAR Intents (1Click). Every swap carries the researcher's fee
// (1Click appFees), so the researcher is paid per trade without ever seeing the investor's funds.
//
// Usage:
//   node scripts/follow.mjs mandate            publish the follow mandate (once)
//   node scripts/follow.mjs plan               show the rebalance it would do
//   node scripts/follow.mjs rebalance          do it on mainnet
import fs from 'fs';
import { account, oneclick, sleep, REGISTRY, AGENT, USDC } from './near.mjs';
import { RESEARCHER } from './researcher.mjs';
import { canonical, sha256Hex } from '../web/alpha.js';

const STRATEGY = { account: RESEARCHER, id: process.env.TN_STRATEGY || 'dip-in-uptrend' };
const PLATFORM = { recipient: REGISTRY, bps: 5 };
// Strategy symbols -> the NEP-141 the agent actually holds on NEAR.
const ASSETS = {
  NEAR: { id: 'nep141:wrap.near', contract: 'wrap.near', decimals: 24 },
  BTC: { id: 'nep141:nbtc.bridge.near', contract: 'nbtc.bridge.near', decimals: 8 },
  ETH: { id: 'nep141:eth.bridge.near', contract: 'eth.bridge.near', decimals: 18 },
  RHEA: { id: 'nep141:token.rhealab.near', contract: 'token.rhealab.near', decimals: 18 },
  AURORA: { id: 'nep141:aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near', contract: 'aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near', decimals: 18 },
  USDC: { id: USDC, contract: USDC.slice(7), decimals: 6 },
};
const LOG = new URL('../web/data/follow-trades.json', import.meta.url);
const GAS = 30000000000000n;
const agent = await account('alpha-bot-demo');

async function entries(acct) {
  const list = await agent.viewFunction({ contractId: REGISTRY, methodName: 'get_mandates', args: { agent: acct } });
  return list.map((m) => { let j = null; try { j = JSON.parse(m.mandate); } catch {} return { ...m, json: j }; });
}
export async function strategyState() {
  const all = await entries(STRATEGY.account);
  const card = all.filter((e) => e.json?.kind === 'strategy' && e.json.id === STRATEGY.id).at(-1);
  const signal = all.filter((e) => e.json?.kind === 'signal' && e.json.id === STRATEGY.id).at(-1);
  if (!card) throw new Error('strategy card not found on-chain');
  return { card, signal };
}

async function mandate() {
  const { card } = await strategyState();
  const universe = card.json.settings.universe;
  const m = {
    kind: 'follow', v: 1, agent: AGENT,
    description: `Follows ${STRATEGY.id} by ${STRATEGY.account}: holds the signal's target weights, rest in USDC.`,
    strategy: { account: STRATEGY.account, id: STRATEGY.id, card_hash: card.mandate_hash },
    cash_asset: USDC,
    assets: Object.fromEntries(universe.map((s) => [s, ASSETS[s].id])),
    allowed_assets: [...universe.map((s) => ASSETS[s].id), USDC],
    max_trade_usd: 5, max_slippage_bps: 100, max_signal_age_hours: 36,
    researcher_fee_bps: card.json.fee.bps,
    materiality: { adverse_if_findings_at_least: 3, material_usd: 10 },
  };
  const text = canonical(m);
  const r = await agent.functionCall({ contractId: REGISTRY, methodName: 'publish_mandate', args: { mandate: text }, gas: GAS });
  console.log(`follow mandate published (${text.length} bytes), tx ${r.transaction.hash}`);
}

const toRaw = (amount, decimals) => {
  const [i, f = ''] = String(amount).split('.');
  return (BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
};
const fromRaw = (raw, decimals) => Number(BigInt(raw)) / 10 ** decimals;

async function ensureStorage(contract, accountId) {
  const s = await agent.viewFunction({ contractId: contract, methodName: 'storage_balance_of', args: { account_id: accountId } }).catch(() => null);
  if (s) return;
  await agent.functionCall({ contractId: contract, methodName: 'storage_deposit', args: { account_id: accountId, registration_only: true }, gas: GAS, attachedDeposit: 1250000000000000000000n });
}

async function holdings(syms) {
  const prices = Object.fromEntries((await oneclick('/tokens')).map((t) => [t.assetId, t.price]));
  const out = {};
  for (const s of [...syms, 'USDC']) {
    const a = ASSETS[s];
    const raw = await agent.viewFunction({ contractId: a.contract, methodName: 'ft_balance_of', args: { account_id: AGENT } }).catch(() => '0');
    const amount = fromRaw(raw, a.decimals);
    out[s] = { raw, amount, usd: amount * (prices[a.id] || 0), price: prices[a.id] || 0 };
  }
  return out;
}

export async function plan() {
  const { card, signal } = await strategyState();
  if (!signal) throw new Error('no signal published yet');
  const age = (Date.now() - Number(BigInt(signal.timestamp_ns) / 1000000n)) / 3.6e6;
  const universe = card.json.settings.universe;
  const h = await holdings(universe);
  const equity = Object.values(h).reduce((s, x) => s + x.usd, 0);
  const trades = [];
  for (const s of universe) {
    const target = (signal.json.weights[s] || 0) * equity;
    const diff = target - h[s].usd;
    if (diff < -0.5) {
      const sellUsd = Math.min(-diff, 5 * 0.95);
      const amt = target === 0 && -diff <= 5 * 0.95 ? h[s].raw : BigInt(Math.floor((sellUsd / h[s].price) * 10 ** ASSETS[s].decimals)).toString();
      trades.push({ from: s, to: 'USDC', raw: amt, usd: sellUsd });
    }
  }
  for (const s of universe) {
    const diff = (signal.json.weights[s] || 0) * equity - h[s].usd;
    if (diff > 0.5) {
      const usd = Math.min(diff, 5 * 0.95);
      trades.push({ from: 'USDC', to: s, raw: BigInt(Math.floor(usd * 1e6)).toString(), usd });
    }
  }
  return { signal, ageHours: age, equity, holdings: h, trades };
}

async function swap(t, signal, card) {
  const a = ASSETS[t.from], b = ASSETS[t.to];
  await ensureStorage(b.contract, AGENT);
  // 1Click without a partner key records half of each requested app fee, so ask for 2x the agreed bps.
  const appFees = [{ recipient: card.json.fee.recipient, fee: card.json.fee.bps * 2 }, { recipient: PLATFORM.recipient, fee: PLATFORM.bps * 2 }];
  const q = await oneclick('/quote', {
    dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100,
    originAsset: a.id, depositType: 'ORIGIN_CHAIN', destinationAsset: b.id, amount: t.raw,
    refundTo: AGENT, refundType: 'ORIGIN_CHAIN', recipient: AGENT, recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 20 * 60 * 1000).toISOString(), appFees,
  });
  const dep = q.quote.depositAddress;
  console.log(`  ${t.from} -> ${t.to} $${q.quote.amountInUsd} (fees recorded ${JSON.stringify(q.quoteRequest.appFees)}) deposit ${dep}`);
  await ensureStorage(a.contract, dep);
  const r = await agent.functionCall({ contractId: a.contract, methodName: 'ft_transfer', args: { receiver_id: dep, amount: t.raw }, gas: GAS, attachedDeposit: 1n });
  const txHash = r.transaction.hash;
  console.log(`  deposit tx ${txHash}`);
  await oneclick('/deposit/submit', { txHash, depositAddress: dep }).catch(() => {});
  let status;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    status = await oneclick(`/status?depositAddress=${dep}`).catch(() => null);
    if (status && ['SUCCESS', 'REFUNDED', 'FAILED'].includes(status.status)) break;
  }
  console.log(`  status ${status?.status} out ${status?.swapDetails?.amountOutFormatted}`);
  const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [];
  log.push({ at: new Date().toISOString(), strategy: STRATEGY, signal_hash: signal.mandate_hash, signal_date: signal.json.date, from: t.from, to: t.to, usd: Number(q.quote.amountInUsd), txHash, depositAddress: dep, status: status?.status, amountOut: status?.swapDetails?.amountOutFormatted, appFees: q.quoteRequest.appFees });
  fs.writeFileSync(LOG, JSON.stringify(log, null, 2));
}

const cmd = process.argv[2];
if (cmd === 'mandate') await mandate();
else if (cmd === 'plan' || cmd === 'rebalance') {
  const p = await plan();
  console.log(`signal ${p.signal.json.date} (${p.ageHours.toFixed(1)}h old) weights ${JSON.stringify(p.signal.json.weights)} | equity $${p.equity.toFixed(2)}`);
  for (const [s, x] of Object.entries(p.holdings)) console.log(`  hold ${s}: ${x.amount.toFixed(6)} ($${x.usd.toFixed(2)})`);
  for (const t of p.trades) console.log(`  trade ${t.from} -> ${t.to} ~$${t.usd.toFixed(2)}`);
  if (cmd === 'rebalance') {
    const { card } = await strategyState();
    for (const t of p.trades) await swap(t, p.signal, card);
  }
} else console.log('usage: follow.mjs mandate | plan | rebalance');
