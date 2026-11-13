// The researcher side. A researcher account publishes strategy cards and daily signals to the registry.
// A hidden strategy publishes only a commitment to its logic (sha256 of expression + settings + salt),
// its backtest stats and its daily target weights. The expression itself stays in a private file.
//
// Usage:
//   node scripts/researcher.mjs account                 create researcher-1.top-notch.near (once)
//   node scripts/researcher.mjs publish <id>            backtest + publish the strategy card
//   node scripts/researcher.mjs signal <id>             compute today's target weights + publish them
//   node scripts/researcher.mjs preview <id>            backtest only, print the card
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { account, saveNewKey, parseNear, KEY_DIR, REGISTRY } from './near.mjs';
import { backtest, logicCommit, canonical, sha256Hex, checkGates } from '../web/alpha.js';
import { KeyPair } from 'near-api-js';

export const RESEARCHER = 'researcher-1.top-notch.near';
const PRIVATE = path.join(KEY_DIR, 'strategies-private.json'); // never committed
const GAS = 30000000000000n;

// The strategy book. Public strategies show their expression; hidden ones keep it in PRIVATE.
export const BOOK = {
  'dip-in-uptrend': {
    name: 'Dip in an uptrend',
    description: 'Buys NEAR-ecosystem tokens that fell yesterday while still above their 30-day trend. Sits in USDC when nothing qualifies.',
    visibility: 'hidden',
    settings: { top_n: 3, cash_if_negative: true, fee_bps: 35, max_weight: 1, universe: ['NEAR', 'RHEA', 'AURORA', 'BTC', 'ETH'] },
    fee_bps: 20,
  },
  'trend-5-20': {
    name: 'Majors trend 5/20',
    description: 'Holds the two majors whose 5-day average is furthest above their 20-day average.',
    visibility: 'public',
    expression: 'ts_mean(close, 5) / ts_mean(close, 20) - 1',
    settings: { top_n: 2, cash_if_negative: true, fee_bps: 35, max_weight: 1, universe: ['NEAR', 'BTC', 'ETH', 'SOL', 'ZEC', 'XRP', 'DOGE', 'SUI'] },
    fee_bps: 15,
  },
};

function privateLogic(id) {
  const all = fs.existsSync(PRIVATE) ? JSON.parse(fs.readFileSync(PRIVATE, 'utf8')) : {};
  if (!all[id]) throw new Error(`no private logic for ${id} in ${PRIVATE}`);
  return all[id];
}

export function logicOf(id) {
  const s = BOOK[id];
  if (s.visibility === 'public') return { expression: s.expression, salt: 'public' };
  return privateLogic(id);
}

const prices = () => JSON.parse(fs.readFileSync(new URL('../web/data/prices.json', import.meta.url), 'utf8'));
const pricesText = () => fs.readFileSync(new URL('../web/data/prices.json', import.meta.url), 'utf8');
const r4 = (x) => Math.round(x * 1e4) / 1e4;

export async function buildCard(id) {
  const s = BOOK[id];
  const { expression, salt } = logicOf(id);
  const r = backtest(expression, prices(), s.settings);
  const commit = await logicCommit(expression, s.settings, salt);
  const card = {
    kind: 'strategy', v: 1, id, name: s.name, description: s.description, visibility: s.visibility,
    expression: s.visibility === 'public' ? expression : undefined,
    logic_commit: commit,
    settings: s.settings,
    data: { from: r.period.from, to: r.period.to, prices_sha256: await sha256Hex(pricesText()) },
    stats: {
      sharpe: r4(r.stats.sharpe), fitness: r4(r.stats.fitness), max_drawdown: r4(r.stats.max_drawdown), turnover: r4(r.stats.turnover),
      total_return: r4(r.stats.total_return), oos_sharpe: r4(r.out_of_sample.sharpe), days: r.stats.days,
    },
    fee: { recipient: RESEARCHER, bps: s.fee_bps },
    signals: 'daily, published to this registry by the researcher account',
  };
  return { card, result: r };
}

async function createAccount() {
  const parent = await account('top-notch');
  const k = saveNewKey('researcher-1', RESEARCHER);
  const state = await parent.connection.provider.query({ request_type: 'view_account', finality: 'final', account_id: RESEARCHER }).catch(() => null);
  if (state) { console.log('exists'); return; }
  const r = await parent.createAccount(RESEARCHER, KeyPair.fromString(k.private_key).getPublicKey(), BigInt(parseNear('0.25')));
  console.log(`created ${RESEARCHER}, tx ${r.transaction.hash}`);
  if (!fs.existsSync(PRIVATE)) {
    // The hidden strategy's logic. Only the researcher (and, under engagement, the auditor) hold this file.
    fs.writeFileSync(PRIVATE, JSON.stringify({ 'dip-in-uptrend': { expression: '-ts_delta(close, 1) / delay(close, 1) * (close > ts_mean(close, 30))', salt: crypto.randomBytes(16).toString('hex') } }, null, 2), { mode: 0o600 });
  }
}

// The daily equity curve the researcher publishes next to the card (returns only, never the logic).
function writeCurve(id, r) {
  const out = { id, from: r.period.from, to: r.period.to, split_at: r.daily[Math.floor(r.daily.length * 0.7)]?.date, points: r.daily.map((d) => [d.date, +d.equity.toFixed(5), +d.bench.toFixed(5)]) };
  fs.writeFileSync(new URL(`../web/data/curve-${id}.json`, import.meta.url), JSON.stringify(out));
}

async function publishCard(id) {
  const { card, result } = await buildCard(id);
  writeCurve(id, result);
  const text = canonical(card);
  console.log(text.length, 'bytes', text);
  console.log('gates:', checkGates(result).map((g) => `${g.pass ? '✓' : '✗'} ${g.label}`).join(' | '));
  const acct = await account('researcher-1');
  const r = await acct.functionCall({ contractId: REGISTRY, methodName: 'publish_mandate', args: { mandate: text }, gas: GAS, attachedDeposit: 0n });
  console.log(`card published, tx ${r.transaction.hash}`);
}

// Today's target weights, computed from the latest COMPLETE daily candle, tied to a dated price snapshot.
export async function buildSignal(id) {
  const s = BOOK[id];
  const { expression } = logicOf(id);
  const p = prices();
  const r = backtest(expression, p, s.settings);
  const date = p.dates.at(-1);
  const snap = new URL(`../web/data/snapshots/prices-${date}.json`, import.meta.url);
  if (!fs.existsSync(snap)) throw new Error(`missing snapshot ${snap.pathname}; run fetch-prices first`);
  return { kind: 'signal', v: 1, id, date, weights: r.latest_signal.weights, cash: r4(1 - Object.values(r.latest_signal.weights).reduce((a, b) => a + b, 0)), prices_sha256: await sha256Hex(fs.readFileSync(snap, 'utf8')) };
}

async function publishSignal(id) {
  const sig = await buildSignal(id);
  const text = canonical(sig);
  console.log(text);
  const acct = await account('researcher-1');
  const r = await acct.functionCall({ contractId: REGISTRY, methodName: 'publish_mandate', args: { mandate: text }, gas: GAS, attachedDeposit: 0n });
  console.log(`signal published, tx ${r.transaction.hash}`);
}

const [cmd, id] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (cmd === 'account') await createAccount();
  else if (cmd === 'publish') await publishCard(id);
  else if (cmd === 'signal') await publishSignal(id);
  else if (cmd === 'curve') writeCurve(id, (await buildCard(id)).result);
  else if (cmd === 'preview') { const { card, result } = await buildCard(id); console.log(JSON.stringify(card, null, 2), checkGates(result)); console.log(JSON.stringify(await buildSignal(id))); }
  else console.log('usage: researcher.mjs account | publish <id> | signal <id> | curve <id> | preview <id>');
}
