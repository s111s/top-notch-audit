// Strategy audit. The auditor is given the hidden logic under engagement (investors never see it) and tests:
//   1. Commitment: sha256(expression | settings | salt) equals the logic_commit on the on-chain card.
//   2. Backtest: rerunning the logic on the price snapshot named on the card reproduces the claimed stats.
//   3. Signals: every on-chain signal is reproduced exactly from the logic and the snapshot it names.
//   4. Timing: every signal was published after its candle closed (no hindsight) and not backdated.
// The opinion is decided here by code; NEAR AI Cloud only writes and signs the letter.
//
// Usage: node scripts/strategy-audit.mjs <strategy-id> [--no-publish] [--no-letter]
import fs from 'fs';
import { backtest, logicCommit, sha256Hex, canonical } from '../web/alpha.js';
import { getStrategy, OPINION_TEXT } from '../web/engine.js';
import { account, REGISTRY } from './near.mjs';
import { RESEARCHER, BOOK, logicOf } from './researcher.mjs';
import { writeLetter } from './letter.mjs';

const id = process.argv[2] || 'dip-in-uptrend';
const flags = new Set(process.argv.slice(3));
const snapPath = (date) => new URL(`../web/data/snapshots/prices-${date}.json`, import.meta.url);
const close = (a, b) => Math.abs(a - b) < 1e-3;

const st = await getStrategy(RESEARCHER, id);
const card = st.cards.at(-1);
if (!card) throw new Error('no card on-chain');
const { expression, salt } = logicOf(id);
const checks = [];

// 1. commitment
const commit = await logicCommit(expression, card.json.settings, salt);
checks.push({ test: 'Logic matches its commitment', pass: commit === card.json.logic_commit, detail: `recomputed ${commit.slice(0, 12)}… vs card ${card.json.logic_commit.slice(0, 12)}…` });

// 2. backtest stats
const snaps = fs.readdirSync(new URL('../web/data/snapshots/', import.meta.url));
let base = null;
for (const f of snaps) { const t = fs.readFileSync(new URL(`../web/data/snapshots/${f}`, import.meta.url), 'utf8'); if ((await sha256Hex(t)) === card.json.data.prices_sha256) base = JSON.parse(t); }
if (!base) checks.push({ test: 'Backtest reproduces the claimed stats', pass: false, detail: 'price snapshot named on the card was not found' });
else {
  const r = backtest(expression, base, card.json.settings);
  const claimed = card.json.stats;
  const got = { sharpe: r.stats.sharpe, fitness: r.stats.fitness, max_drawdown: r.stats.max_drawdown, turnover: r.stats.turnover, total_return: r.stats.total_return, oos_sharpe: r.out_of_sample.sharpe };
  const off = Object.keys(got).filter((k) => !close(got[k], claimed[k]));
  checks.push({ test: 'Backtest reproduces the claimed stats', pass: off.length === 0, detail: off.length ? `differs on ${off.join(', ')}` : `Sharpe ${got.sharpe.toFixed(2)}, fitness ${got.fitness.toFixed(2)}, drawdown ${(got.max_drawdown * 100).toFixed(1)}%, turnover ${(got.turnover * 100).toFixed(1)}%, ${r.period.days} days` });
}

// 3 + 4. signals
const signals = [];
for (const s of st.signals) {
  const f = snapPath(s.json.date);
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  const okSnap = text && (await sha256Hex(text)) === s.json.prices_sha256;
  let same = false;
  if (okSnap) {
    const r = backtest(expression, JSON.parse(text), card.json.settings);
    same = canonical(r.latest_signal.weights) === canonical(s.json.weights) && r.latest_signal.date === s.json.date;
  }
  const candleClosed = Date.parse(`${s.json.date}T00:00:00Z`) + 86400000;
  const timely = s.ms >= candleClosed && s.ms - candleClosed < 48 * 3600000;
  signals.push({ date: s.json.date, hash: s.hash, weights: s.json.weights, reproduced: same, snapshot_verified: !!okSnap, published_at: new Date(s.ms).toISOString(), timely });
}
checks.push({ test: 'Every signal reproduced from the committed logic', pass: signals.length > 0 && signals.every((s) => s.reproduced), detail: `${signals.filter((s) => s.reproduced).length} of ${signals.length} signals match` });
checks.push({ test: 'Signals published after the candle closed, not backdated', pass: signals.every((s) => s.timely), detail: signals.map((s) => `${s.date} → ${s.published_at.slice(0, 16)}Z`).join('; ') });

const failed = checks.filter((c) => !c.pass);
const opinion = signals.length === 0 ? 'disclaimer' : failed.length === 0 ? 'clean' : failed.some((c) => c.test.startsWith('Logic') || c.test.startsWith('Every')) ? 'adverse' : 'qualified';
const report = {
  schema: 'top-notch/strategy-report@1', generated_at: new Date().toISOString(), registry: REGISTRY,
  strategy: { account: RESEARCHER, id, name: card.json.name, visibility: card.json.visibility, card_hash: card.hash, logic_commit: card.json.logic_commit },
  claimed_stats: card.json.stats, checks, signals, opinion,
  scope: card.json.visibility === 'hidden' ? 'The auditor saw the strategy logic under engagement. It is not disclosed in this report; only the commitment is.' : 'Public strategy: anyone can rerun this audit.',
};
report.report_hash = await sha256Hex(canonical(report));
console.log(`opinion ${opinion}`); for (const c of checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.test}: ${c.detail}`);

if (!flags.has('--no-publish')) {
  const reg = await account('top-notch');
  const r = await reg.functionCall({ contractId: REGISTRY, methodName: 'publish_report', args: { agent: RESEARCHER, mandate_hash: card.hash, report_hash: report.report_hash, opinion, trades_tested: signals.length, findings: failed.length, uri: '' }, gas: 30000000000000n });
  report.publish_tx = r.transaction.hash;
  console.log(`report published, tx ${report.publish_tx}`);
}
if (!flags.has('--no-letter')) {
  try {
    report.letter = await writeLetter({
      facts: { strategy: report.strategy, opinion: OPINION_TEXT[opinion].label, report_hash: report.report_hash, checks, signals: signals.map(({ date, reproduced, timely }) => ({ date, reproduced, timely })), scope: report.scope },
      system: 'You write an independent auditor\'s report on a trading strategy whose logic is confidential. The opinion has ALREADY been decided by deterministic tests; state it exactly as given and never change it. Never guess or describe the hidden logic. Plain English, under 200 words, in this structure: "Opinion", "What we tested", "Results", "Scope and limits". Mention the report hash. No tables.',
      mustInclude: opinion,
      attestationFile: new URL(`../web/data/attestation-strategy-${id}.json`, import.meta.url),
    });
    console.log('letter signed by', report.letter.signing_address);
  } catch (e) { console.log('letter skipped:', e.message); }
}
fs.writeFileSync(new URL(`../web/data/strategy-report-${id}.json`, import.meta.url), JSON.stringify(report, null, 2));
