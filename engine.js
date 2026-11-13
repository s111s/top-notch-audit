// Top Notch audit engine. Runs the same in the browser and in Node 18+ (uses fetch + WebCrypto).
// The opinion is decided here, by deterministic rules. No LLM is involved in this file.

export const ENGINE_VERSION = '1.0.0';

export const CONFIG = {
  rpc: 'https://rpc.mainnet.near.org',
  nearblocks: 'https://api.nearblocks.io/v1',
  oneclick: 'https://1click.chaindefuser.com/v0',
  registry: 'top-notch.near',
  explorerTx: (h) => `https://nearblocks.io/txns/${h}`,
  intentsExplorer: (addr) => `https://explorer.near-intents.org/transactions/${addr}`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, opts = {}, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 404) return { __notFound: true };
      if (res.status === 429 || res.status >= 500) { last = new Error(`${res.status} ${url}`); await sleep(3000 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (e) { last = e; await sleep(1000 * (i + 1)); }
  }
  throw last;
}

const txCache = new Map();
const statusCache = new Map();

async function rpc(method, params) {
  if (method === 'tx' && txCache.has(params.tx_hash)) return txCache.get(params.tx_hash);
  const j = await getJson(CONFIG.rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'tn', method, params }),
  });
  if (j.error) throw new Error(`RPC ${method}: ${JSON.stringify(j.error).slice(0, 200)}`);
  if (method === 'tx' && j.result?.transaction) txCache.set(params.tx_hash, j.result);
  return j.result;
}

function b64ToUtf8(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf8');
}

export async function viewCall(contract, method, args = {}) {
  const argsB64 = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(JSON.stringify(args))))
    : Buffer.from(JSON.stringify(args)).toString('base64');
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: argsB64 });
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result)));
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Canonical JSON: keys sorted, no whitespace. Used for the report hash.
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const isImplicit = (a) => /^[0-9a-f]{64}$/.test(a || '');

let tokenCache;
export async function tokens() {
  if (!tokenCache) {
    const list = await getJson(`${CONFIG.oneclick}/tokens`);
    tokenCache = Object.fromEntries(list.map((t) => [t.assetId, t]));
  }
  return tokenCache;
}
export async function symbolOf(assetId) {
  const t = (await tokens())[assetId];
  return t ? t.symbol : assetId.replace(/^nep141:/, '').slice(0, 14);
}

// 1. List transactions signed by the agent (NearBlocks index), oldest first.
export async function listAgentTxs(agent, maxPages = 2) {
  const out = [];
  let cursor;
  for (let p = 0; p < maxPages; p++) {
    const url = `${CONFIG.nearblocks}/account/${agent}/txns-only?per_page=25&order=desc${cursor ? `&cursor=${cursor}` : ''}`;
    const j = await getJson(url);
    if (j.__notFound || !j.txns?.length) break;
    out.push(...j.txns.filter((t) => t.signer_account_id === agent));
    if (!j.cursor || j.txns.length < 25) break;
    cursor = j.cursor;
    await sleep(400);
  }
  return out.sort((a, b) => (BigInt(a.block_timestamp) < BigInt(b.block_timestamp) ? -1 : 1));
}

// 2. Read each transaction from the NEAR RPC and find 1Click deposits and mandate publications.
export async function collectEvidence(agent, onProgress = () => {}) {
  const txs = await listAgentTxs(agent);
  onProgress(`Found ${txs.length} transactions signed by ${agent}`);
  const deposits = [];
  const fetched = await mapLimit(txs, 6, (t) => rpc('tx', { tx_hash: t.transaction_hash, sender_account_id: agent, wait_until: 'NONE' }).catch(() => null));
  for (let i = 0; i < txs.length; i++) {
    const t = txs[i];
    const r = fetched[i];
    if (!r?.transaction) continue;
    const ok = r.status && r.status.SuccessValue !== undefined;
    for (const a of r.transaction.actions) {
      const fc = a.FunctionCall;
      if (fc && fc.method_name === 'ft_transfer') {
        let args = {};
        try { args = JSON.parse(b64ToUtf8(fc.args)); } catch {}
        if (isImplicit(args.receiver_id)) deposits.push({ tx: t.transaction_hash, ok, time_ns: t.block_timestamp, token: r.transaction.receiver_id, depositAddress: args.receiver_id, amount: args.amount });
      }
      if (a.Transfer && isImplicit(r.transaction.receiver_id)) {
        deposits.push({ tx: t.transaction_hash, ok, time_ns: t.block_timestamp, token: 'near', depositAddress: r.transaction.receiver_id, amount: a.Transfer.deposit });
      }
    }
  }
  onProgress(`${deposits.length} outgoing deposits to one-time addresses`);
  const statuses = await mapLimit(deposits, 4, async (d) => {
    if (statusCache.has(d.depositAddress)) return statusCache.get(d.depositAddress);
    const st = await getJson(`${CONFIG.oneclick}/status?depositAddress=${d.depositAddress}`).catch(() => ({ __notFound: true }));
    if (['SUCCESS', 'REFUNDED', 'FAILED'].includes(st.status)) statusCache.set(d.depositAddress, st);
    return st;
  });
  const trades = [];
  for (let i = 0; i < deposits.length; i++) {
    if (statuses[i].__notFound) continue; // not a 1Click deposit: out of scope
    trades.push(await normaliseTrade(deposits[i], statuses[i]));
  }
  onProgress(`${trades.length} of them confirmed as 1Click / NEAR Intents swaps`);
  return { txCount: txs.length, trades };
}

async function normaliseTrade(d, s) {
  const q = s.quoteResponse || {};
  const req = q.quoteRequest || {};
  const quote = q.quote || {};
  const sd = s.swapDetails || {};
  const inAsset = req.originAsset || (d.token === 'near' ? 'near' : `nep141:${d.token}`);
  const outAsset = req.destinationAsset;
  const quotedOut = Number(quote.amountOut || 0);
  const actualOut = Number(sd.amountOut || 0);
  const realisedSlippageBps = quotedOut > 0 && actualOut > 0 ? Math.round(((quotedOut - actualOut) / quotedOut) * 10000) : null;
  return {
    tx: d.tx,
    depositAddress: d.depositAddress,
    time: new Date(Number(BigInt(d.time_ns) / 1000000n)).toISOString(),
    status: s.status,
    in: { asset: inAsset, symbol: await symbolOf(inAsset), amount: sd.amountInFormatted || quote.amountInFormatted, usd: Number(sd.amountInUsd || quote.amountInUsd || 0) },
    out: { asset: outAsset, symbol: outAsset ? await symbolOf(outAsset) : '?', amount: sd.amountOutFormatted || quote.amountOutFormatted, usd: Number(sd.amountOutUsd || quote.amountOutUsd || 0) },
    requestedSlippageBps: req.slippageTolerance ?? null,
    realisedSlippageBps,
    appFees: req.appFees || [],
    destinationTxs: (sd.destinationChainTxHashes || []).map((x) => x.hash || x),
  };
}

// Every account that has published a mandate to the registry (= every agent under audit).
export async function listAuditedAgents() {
  const j = await getJson(`${CONFIG.nearblocks}/account/${CONFIG.registry}/txns?method=publish_mandate&per_page=50`);
  const agents = new Set((j.txns || []).filter((t) => t.receipt_outcome?.status !== false).map((t) => t.predecessor_account_id));
  return [...agents];
}

// 3. Read the mandate the agent published on-chain (latest one wins; trades before it are out of period).
export async function getMandate(agent) {
  const list = await viewCall(CONFIG.registry, 'get_mandates', { agent }).catch(() => []);
  if (!list.length) return null;
  const m = list[list.length - 1];
  let rules = null;
  try { rules = JSON.parse(m.mandate); } catch {}
  const recomputed = await sha256Hex(m.mandate);
  return { ...m, rules, hashVerified: recomputed === m.mandate_hash, published_at: new Date(Number(BigInt(m.timestamp_ns) / 1000000n)).toISOString() };
}

// 4. Rule engine. Every check returns pass/fail with the evidence behind it.
export function testTrade(t, rules) {
  const checks = [];
  const allowed = rules.allowed_assets || [];
  checks.push({ rule: 'Allowed tokens', pass: allowed.includes(t.in.asset) && allowed.includes(t.out.asset), detail: `${t.in.symbol} → ${t.out.symbol}` });
  if (rules.max_trade_usd != null) checks.push({ rule: 'Max trade size', pass: t.in.usd <= rules.max_trade_usd, detail: `$${t.in.usd.toFixed(2)} vs limit $${rules.max_trade_usd}` });
  if (rules.max_slippage_bps != null) {
    const req = t.requestedSlippageBps;
    const real = t.realisedSlippageBps;
    const pass = (req == null || req <= rules.max_slippage_bps) && (real == null || real <= rules.max_slippage_bps);
    checks.push({ rule: 'Max slippage', pass, detail: `requested ${req ?? '?'} bps, realised ${real ?? '?'} bps vs limit ${rules.max_slippage_bps} bps` });
  }
  checks.push({ rule: 'Settled', pass: t.status === 'SUCCESS', detail: `1Click status ${t.status}` });
  return checks;
}

export function decideOpinion(findings, tradesTested, rules) {
  if (tradesTested === 0) return 'disclaimer';
  if (findings.length === 0) return 'clean';
  const m = rules.materiality || {};
  const adverseCount = m.adverse_if_findings_at_least ?? 3;
  const materialUsd = m.material_usd ?? 10;
  const material = findings.some((f) => (f.usd || 0) >= materialUsd);
  return findings.length >= adverseCount || material ? 'adverse' : 'qualified';
}

// 5. Full audit: mandate + evidence + tests + opinion + report hash.
export async function audit(agent, onProgress = () => {}) {
  agent = agent.trim().toLowerCase();
  onProgress(`Reading mandate for ${agent} from ${CONFIG.registry}`);
  const mandate = await getMandate(agent);
  const ev = await collectEvidence(agent, onProgress);
  const base = { schema: 'top-notch/report@1', engine_version: ENGINE_VERSION, agent, registry: CONFIG.registry, generated_at: new Date().toISOString() };
  if (!mandate || !mandate.rules || !mandate.hashVerified) {
    const report = { ...base, mandate: mandate ? { hash: mandate.mandate_hash, text: mandate.mandate } : null, trades: ev.trades, findings: [], opinion: 'disclaimer',
      basis: mandate ? 'The published mandate could not be read as valid rules.' : 'The agent has not published a mandate, so there is nothing to test its trades against.' };
    report.report_hash = await sha256Hex(canonical(report));
    return report;
  }
  const rules = mandate.rules;
  const inPeriod = ev.trades.filter((t) => t.time >= mandate.published_at);
  const tested = inPeriod.map((t, i) => ({ n: i + 1, ...t, checks: testTrade(t, rules) }));
  const findings = [];
  for (const t of tested) for (const c of t.checks) if (!c.pass) findings.push({ trade: t.n, tx: t.tx, rule: c.rule, detail: c.detail, usd: t.in.usd });
  // Daily rules across trades
  const byDay = {};
  for (const t of tested) (byDay[t.time.slice(0, 10)] ||= []).push(t);
  for (const [day, ts] of Object.entries(byDay)) {
    if (rules.max_trades_per_day != null && ts.length > rules.max_trades_per_day) findings.push({ trade: null, tx: null, rule: 'Max trades per day', detail: `${ts.length} trades on ${day} vs limit ${rules.max_trades_per_day}`, usd: 0 });
    if (rules.max_daily_loss_usd != null) {
      const loss = ts.reduce((s, t) => s + (t.status === 'SUCCESS' ? t.in.usd - t.out.usd : 0), 0);
      if (loss > rules.max_daily_loss_usd) findings.push({ trade: null, tx: null, rule: 'Max daily loss', detail: `$${loss.toFixed(2)} lost on ${day} vs limit $${rules.max_daily_loss_usd}`, usd: loss });
    }
  }
  const opinion = decideOpinion(findings, tested.length, rules);
  const report = {
    ...base,
    mandate: { hash: mandate.mandate_hash, text: mandate.mandate, published_at: mandate.published_at, block_height: mandate.block_height },
    period: { from: mandate.published_at, to: tested.length ? tested[tested.length - 1].time : mandate.published_at },
    out_of_period_trades: ev.trades.length - inPeriod.length,
    trades: tested,
    findings,
    opinion,
  };
  report.report_hash = await sha256Hex(canonical(report));
  return report;
}

// Verify a stored report: recompute its hash and compare with what the registry has on-chain.
export async function verifyReport(report) {
  const { report_hash, letter, publish_tx, ...rest } = report;
  const recomputed = await sha256Hex(canonical(rest));
  const onchain = await viewCall(CONFIG.registry, 'get_reports', { agent: report.agent }).catch(() => []);
  const match = onchain.find((r) => r.report_hash === report_hash);
  return { recomputed, hashMatches: recomputed === report_hash, onchain: match || null };
}

export const OPINION_TEXT = {
  clean: { label: 'Clean opinion', short: 'Every tested trade followed the mandate.' },
  qualified: { label: 'Qualified opinion', short: 'The agent followed its mandate, except for the findings listed.' },
  adverse: { label: 'Adverse opinion', short: 'The agent did not follow its mandate in material ways.' },
  disclaimer: { label: 'Disclaimer of opinion', short: 'Not enough evidence to form an opinion.' },
};
