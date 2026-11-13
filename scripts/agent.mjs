// The demo trading agent "alpha-bot-demo.near".
// It publishes its mandate on-chain, then trades on mainnet through NEAR Intents (1Click API).
// One planned trade deliberately breaks the mandate (buys a token outside the allowlist),
// so the auditor has something real to catch.
//
// Usage:
//   node scripts/agent.mjs mandate            publish the mandate (once)
//   node scripts/agent.mjs trade wNEAR USDC 0.35
//   node scripts/agent.mjs plan               run the full 8-trade demo plan
import fs from 'fs';
import { account, oneclick, sleep, parseNear, USDC, WNEAR, RHEA, REGISTRY, AGENT } from './near.mjs';

const ASSETS = { wNEAR: { id: WNEAR, contract: 'wrap.near', decimals: 24 }, USDC: { id: USDC, contract: USDC.slice(7), decimals: 6 }, RHEA: { id: RHEA, contract: 'token.rhealab.near', decimals: 18 } };
const APP_FEE = { recipient: REGISTRY, fee: 20 }; // requested 0.2%; without a 1Click partner key, 1Click records 0.1% for us
const LOG = new URL('../web/data/agent-trades.json', import.meta.url);

export const MANDATE = {
  version: 1,
  agent: AGENT,
  description: 'Momentum bot that trades NEAR against USDC in small size.',
  allowed_assets: [WNEAR, USDC],
  max_trade_usd: 2.5,
  max_slippage_bps: 100,
  max_trades_per_day: 12,
  max_daily_loss_usd: 1,
  materiality: { adverse_if_findings_at_least: 3, material_usd: 10 },
};

const agent = await account('alpha-bot-demo');
const GAS = 30000000000000n;

const toRaw = (amount, decimals) => {
  const [i, f = ''] = String(amount).split('.');
  return (BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
};

async function publishMandate() {
  const existing = await agent.viewFunction({ contractId: REGISTRY, methodName: 'get_mandates', args: { agent: AGENT } });
  if (existing.length) { console.log('mandate already published:', existing.at(-1).mandate_hash); return; }
  const r = await agent.functionCall({ contractId: REGISTRY, methodName: 'publish_mandate', args: { mandate: JSON.stringify(MANDATE) }, gas: GAS });
  console.log(`mandate published, tx ${r.transaction.hash}`);
}

async function ensureStorage(contract, accountId) {
  const s = await agent.viewFunction({ contractId: contract, methodName: 'storage_balance_of', args: { account_id: accountId } }).catch(() => null);
  if (s) return;
  await agent.functionCall({ contractId: contract, methodName: 'storage_deposit', args: { account_id: accountId, registration_only: true }, gas: GAS, attachedDeposit: BigInt(parseNear('0.00125')) });
}

async function ensureWrapped(minNear) {
  const bal = BigInt(await agent.viewFunction({ contractId: 'wrap.near', methodName: 'ft_balance_of', args: { account_id: AGENT } }));
  const need = BigInt(parseNear(minNear));
  if (bal >= need) return;
  await ensureStorage('wrap.near', AGENT);
  const r = await agent.functionCall({ contractId: 'wrap.near', methodName: 'near_deposit', args: {}, gas: GAS, attachedDeposit: need - bal });
  console.log(`wrapped NEAR, tx ${r.transaction.hash}`);
}

export async function trade(from, to, amount, slippageBps = 50) {
  const a = ASSETS[from], b = ASSETS[to];
  await ensureStorage(b.contract, AGENT);
  const deadline = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const q = await oneclick('/quote', {
    dry: false, swapType: 'EXACT_INPUT', slippageTolerance: slippageBps,
    originAsset: a.id, depositType: 'ORIGIN_CHAIN', destinationAsset: b.id, amount: toRaw(amount, a.decimals),
    refundTo: AGENT, refundType: 'ORIGIN_CHAIN', recipient: AGENT, recipientType: 'DESTINATION_CHAIN', deadline,
    appFees: [APP_FEE],
  });
  const dep = q.quote.depositAddress;
  console.log(`quote ${amount} ${from} -> ~${q.quote.amountOutFormatted} ${to} ($${q.quote.amountInUsd}) deposit ${dep}`);
  await ensureStorage(a.contract, dep);
  const r = await agent.functionCall({ contractId: a.contract, methodName: 'ft_transfer', args: { receiver_id: dep, amount: toRaw(amount, a.decimals) }, gas: GAS, attachedDeposit: 1n });
  const txHash = r.transaction.hash;
  console.log(`  deposit tx ${txHash}`);
  await oneclick('/deposit/submit', { txHash, depositAddress: dep }).catch((e) => console.log('  submit:', e.message));
  let status;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    status = await oneclick(`/status?depositAddress=${dep}`).catch(() => null);
    if (status && ['SUCCESS', 'REFUNDED', 'FAILED'].includes(status.status)) break;
  }
  console.log(`  status ${status?.status} out ${status?.swapDetails?.amountOutFormatted}`);
  const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [];
  log.push({ at: new Date().toISOString(), from, to, amount, txHash, depositAddress: dep, status: status?.status, amountOut: status?.swapDetails?.amountOutFormatted });
  fs.mkdirSync(new URL('../web/data/', import.meta.url), { recursive: true });
  fs.writeFileSync(LOG, JSON.stringify(log, null, 2));
  return status;
}

const PLAN = [
  ['wNEAR', 'USDC', '0.35'],
  ['wNEAR', 'USDC', '0.35'],
  ['USDC', 'wNEAR', '1.1'],
  ['wNEAR', 'USDC', '0.35'],
  ['wNEAR', 'RHEA', '0.3'], // deliberate breach: RHEA is not on the allowlist
  ['USDC', 'wNEAR', '1.1'],
  ['wNEAR', 'USDC', '0.3'],
  ['USDC', 'wNEAR', '0.9'],
];

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'mandate') await publishMandate();
else if (cmd === 'trade') { await ensureWrapped('0.5'); await trade(rest[0], rest[1], rest[2], Number(rest[3] || 50)); }
else if (cmd === 'plan') {
  await publishMandate();
  await ensureWrapped('1.8');
  const start = Number(process.env.TN_PLAN_START || 0);
  for (const [i, [f, t, amt]] of PLAN.entries()) { if (i < start) continue; console.log(`trade ${i + 1}/${PLAN.length}`); await trade(f, t, amt); }
} else console.log('usage: agent.mjs mandate | trade FROM TO AMOUNT [slippageBps] | plan');
