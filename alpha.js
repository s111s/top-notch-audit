// Alpha engine: a small BRAIN-style expression language, a long-only backtester, and the stats
// (Sharpe, drawdown, turnover, fitness...). Runs the same in the browser and in Node 18+.
// Deterministic: same expression + settings + prices => same stats and the same signal hash.

export const ALPHA_VERSION = '1.0.0';
export const DAYS_PER_YEAR = 365; // crypto trades every day

// ---------- data ----------
// prices.json: { dates: [...], tokens: { SYM: { close: [...], volume: [...] } } }
export function prepare(prices) {
  const syms = Object.keys(prices.tokens);
  const T = prices.dates.length;
  const ffill = (arr) => { let last = null; return arr.map((v) => (v == null ? last : (last = v))); };
  const close = syms.map((s) => ffill(prices.tokens[s].close));
  const volume = syms.map((s) => prices.tokens[s].volume.map((v) => v ?? 0));
  return { syms, dates: prices.dates, T, close, volume };
}

// A field is a matrix [token][day]. All operators work on fields or numbers.
const NaNf = (n, T) => Array.from({ length: n }, () => new Array(T).fill(NaN));
const isF = (x) => Array.isArray(x);
function map2(a, b, f, n, T) {
  if (!isF(a) && !isF(b)) return f(a, b);
  const out = NaNf(n, T);
  for (let i = 0; i < n; i++) for (let t = 0; t < T; t++) out[i][t] = f(isF(a) ? a[i][t] : a, isF(b) ? b[i][t] : b);
  return out;
}
function ts(x, d, f, n, T) { // rolling window over the last d days (inclusive of today)
  d = Math.max(1, Math.round(d));
  const out = NaNf(n, T);
  for (let i = 0; i < n; i++) for (let t = d - 1; t < T; t++) {
    const w = x[i].slice(t - d + 1, t + 1);
    out[i][t] = w.some((v) => !Number.isFinite(v)) ? NaN : f(w, x[i][t]);
  }
  return out;
}
function cs(x, f, n, T) { // cross-section across tokens on each day
  const out = NaNf(n, T);
  for (let t = 0; t < T; t++) {
    const col = []; for (let i = 0; i < n; i++) if (Number.isFinite(x[i][t])) col.push(x[i][t]);
    for (let i = 0; i < n; i++) out[i][t] = Number.isFinite(x[i][t]) ? f(x[i][t], col) : NaN;
  }
  return out;
}
const mean = (w) => w.reduce((s, v) => s + v, 0) / w.length;
const std = (w) => { const m = mean(w); return Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, w.length - 1)); };

export const FUNCTIONS = {
  ts_mean: { args: 2, doc: 'average over the last d days', f: (c, x, d) => ts(x, d, mean, c.n, c.T) },
  ts_sum: { args: 2, doc: 'sum over the last d days', f: (c, x, d) => ts(x, d, (w) => w.reduce((s, v) => s + v, 0), c.n, c.T) },
  ts_std: { args: 2, doc: 'standard deviation over d days', f: (c, x, d) => ts(x, d, std, c.n, c.T) },
  ts_max: { args: 2, doc: 'max over d days', f: (c, x, d) => ts(x, d, (w) => Math.max(...w), c.n, c.T) },
  ts_min: { args: 2, doc: 'min over d days', f: (c, x, d) => ts(x, d, (w) => Math.min(...w), c.n, c.T) },
  ts_delta: { args: 2, doc: 'x today minus x d days ago', f: (c, x, d) => ts(x, d + 1, (w) => w[w.length - 1] - w[0], c.n, c.T) },
  delay: { args: 2, doc: 'x as it was d days ago', f: (c, x, d) => ts(x, d + 1, (w) => w[0], c.n, c.T) },
  ts_rank: { args: 2, doc: 'where today sits in the last d days, 0..1', f: (c, x, d) => ts(x, d, (w, v) => w.filter((u) => u < v).length / Math.max(1, w.length - 1), c.n, c.T) },
  ts_zscore: { args: 2, doc: '(x - mean) / std over d days', f: (c, x, d) => ts(x, d, (w, v) => { const s = std(w); return s ? (v - mean(w)) / s : 0; }, c.n, c.T) },
  rank: { args: 1, doc: 'cross-sectional rank today, 0..1', f: (c, x) => cs(x, (v, col) => (col.length > 1 ? col.filter((u) => u < v).length / (col.length - 1) : 0.5), c.n, c.T) },
  zscore: { args: 1, doc: 'cross-sectional z-score today', f: (c, x) => cs(x, (v, col) => { const s = std(col); return s ? (v - mean(col)) / s : 0; }, c.n, c.T) },
  abs: { args: 1, doc: '|x|', f: (c, x) => map2(x, 0, (a) => Math.abs(a), c.n, c.T) },
  sign: { args: 1, doc: '-1, 0 or 1', f: (c, x) => map2(x, 0, (a) => Math.sign(a), c.n, c.T) },
  log: { args: 1, doc: 'natural log', f: (c, x) => map2(x, 0, (a) => (a > 0 ? Math.log(a) : NaN), c.n, c.T) },
  max: { args: 2, doc: 'larger of two', f: (c, a, b) => map2(a, b, Math.max, c.n, c.T) },
  min: { args: 2, doc: 'smaller of two', f: (c, a, b) => map2(a, b, Math.min, c.n, c.T) },
};

// ---------- parser ----------
// Grammar: expr := cmp ; cmp := add (('>'|'<') add)? ; add := mul (('+'|'-') mul)* ; mul := unary (('*'|'/') unary)*
// unary := '-' unary | atom ; atom := number | name | name '(' args ')' | '(' expr ')'
export function parse(src) {
  const toks = [];
  const re = /\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(\S))/y;
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1]) toks.push({ k: 'num', v: parseFloat(m[1]) });
    else if (m[2]) toks.push({ k: 'id', v: m[2] });
    else if (m[3]) toks.push({ k: 'op', v: m[3] });
    else break;
  }
  let p = 0;
  const peek = () => toks[p];
  const eat = (v) => { if (peek()?.v !== v) throw new Error(`expected "${v}"${peek() ? ` but found "${peek().v}"` : ' at the end'}`); p++; };
  function expr() { let l = add(); while (peek() && (peek().v === '>' || peek().v === '<')) { const op = toks[p++].v; l = { op, l, r: add() }; } return l; }
  function add() { let l = mul(); while (peek() && (peek().v === '+' || peek().v === '-')) { const op = toks[p++].v; l = { op, l, r: mul() }; } return l; }
  function mul() { let l = unary(); while (peek() && (peek().v === '*' || peek().v === '/')) { const op = toks[p++].v; l = { op, l, r: unary() }; } return l; }
  function unary() { if (peek()?.v === '-') { p++; return { op: 'neg', l: unary() }; } return atom(); }
  function atom() {
    const t = toks[p++];
    if (!t) throw new Error('expression ended early');
    if (t.k === 'num') return { num: t.v };
    if (t.v === '(') { const e = expr(); eat(')'); return e; }
    if (t.k === 'id') {
      if (peek()?.v === '(') {
        p++;
        const args = [];
        if (peek()?.v !== ')') { args.push(expr()); while (peek()?.v === ',') { p++; args.push(expr()); } }
        eat(')');
        const fn = FUNCTIONS[t.v];
        if (!fn) throw new Error(`unknown function "${t.v}"`);
        if (args.length !== fn.args) throw new Error(`${t.v} takes ${fn.args} argument(s), got ${args.length}`);
        return { fn: t.v, args };
      }
      if (!FIELDS.includes(t.v)) throw new Error(`unknown field "${t.v}" (fields: ${FIELDS.join(', ')})`);
      return { field: t.v };
    }
    throw new Error(`unexpected "${t.v}"`);
  }
  const tree = expr();
  if (p < toks.length) throw new Error(`unexpected "${toks[p].v}"`);
  return tree;
}

export const FIELDS = ['close', 'volume', 'returns'];

function evaluate(node, c) {
  if ('num' in node) return node.num;
  if (node.field === 'close') return c.close;
  if (node.field === 'volume') return c.volume;
  if (node.field === 'returns') return c.returns;
  if (node.fn) {
    const fn = FUNCTIONS[node.fn];
    const args = node.args.map((a, i) => {
      const v = evaluate(a, c);
      // window lengths must be plain numbers
      if (node.fn.startsWith('ts_') || node.fn === 'delay') if (i === 1 && isF(v)) throw new Error(`${node.fn}: the window must be a number`);
      return v;
    });
    return fn.f(c, ...args);
  }
  const l = evaluate(node.l, c);
  if (node.op === 'neg') return map2(l, 0, (a) => -a, c.n, c.T);
  const r = evaluate(node.r, c);
  const ops = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => (b === 0 ? NaN : a / b), '>': (a, b) => (a > b ? 1 : 0), '<': (a, b) => (a < b ? 1 : 0) };
  return map2(l, r, ops[node.op], c.n, c.T);
}

export function signalField(expression, data) {
  const n = data.syms.length, T = data.T;
  const returns = data.close.map((row) => row.map((v, t) => (t && row[t - 1] ? v / row[t - 1] - 1 : NaN)));
  let s = evaluate(parse(expression), { n, T, close: data.close, volume: data.volume, returns });
  if (!isF(s)) s = data.close.map((row) => row.map(() => s));
  return s;
}

// ---------- portfolio ----------
export const DEFAULT_SETTINGS = { top_n: 3, cash_if_negative: true, fee_bps: 35, max_weight: 0.5, universe: null };

// Long-only: hold the top-N tokens by signal, equal weight (capped), rest in USDC.
// With cash_if_negative, a token only qualifies if its signal is > 0, so the strategy can sit in cash.
export function weightsFor(sig, data, t, settings) {
  const S = { ...DEFAULT_SETTINGS, ...settings };
  const allowed = data.syms.map((s) => !S.universe || S.universe.includes(s));
  const cand = [];
  for (let i = 0; i < data.syms.length; i++) {
    const v = sig[i][t];
    if (!allowed[i] || !Number.isFinite(v) || !Number.isFinite(data.close[i][t])) continue;
    if (S.cash_if_negative && !(v > 0)) continue;
    cand.push([i, v]);
  }
  cand.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const pick = cand.slice(0, S.top_n);
  const w = new Array(data.syms.length).fill(0);
  const each = pick.length ? Math.min(S.max_weight, 1 / S.top_n) : 0;
  for (const [i] of pick) w[i] = each;
  return w;
}

// ---------- backtest ----------
// Signal computed at day t's close sets weights held from t to t+1. No look-ahead.
export function backtest(expression, prices, settings = {}, opts = {}) {
  const data = prepare(prices);
  const S = { ...DEFAULT_SETTINGS, ...settings };
  const sig = signalField(expression, data);
  const T = data.T;
  const W = []; // weights per day
  for (let t = 0; t < T; t++) W.push(weightsFor(sig, data, t, S));
  const daily = []; // {date, ret, turnover, equity}
  let equity = 1, bench = 1;
  const benchI = data.syms.indexOf('NEAR');
  let start = W.findIndex((w) => w.some((x) => x > 0));
  if (start < 0) start = T - 1;
  start = Math.max(start, 30 > T / 3 ? 1 : 30); // warm-up so long windows can form
  for (let t = start; t < T - 1; t++) {
    const prev = t > start ? W[t - 1] : new Array(data.syms.length).fill(0);
    const turnover = W[t].reduce((s, w, i) => s + Math.abs(w - prev[i]), 0) / 2;
    let gross = 0;
    for (let i = 0; i < data.syms.length; i++) if (W[t][i]) gross += W[t][i] * (data.close[i][t + 1] / data.close[i][t] - 1);
    const cost = turnover * 2 * (S.fee_bps / 1e4); // each unit of turnover = a sell + a buy
    const ret = gross - cost;
    equity *= 1 + ret;
    if (benchI >= 0) bench *= data.close[benchI][t + 1] / data.close[benchI][t];
    daily.push({ date: data.dates[t + 1], ret, turnover, equity, bench, weights: W[t] });
  }
  const split = Math.floor(daily.length * (opts.in_sample ?? 0.7));
  const stats = statsOf(daily);
  const latest = W[T - 1];
  return {
    expression, settings: S, syms: data.syms, version: ALPHA_VERSION,
    period: { from: daily[0]?.date, to: daily.at(-1)?.date, days: daily.length },
    stats, in_sample: statsOf(daily.slice(0, split)), out_of_sample: statsOf(daily.slice(split)),
    benchmark: statsOf(daily.map((d, k) => ({ ret: (k ? d.bench / daily[k - 1].bench : d.bench) - 1, turnover: 0 }))),
    daily,
    latest_signal: { date: data.dates[T - 1], weights: Object.fromEntries(data.syms.map((s, i) => [s, +latest[i].toFixed(4)]).filter(([, w]) => w > 0)) },
  };
}

export function statsOf(daily) {
  const n = daily.length;
  if (!n) return null;
  const rets = daily.map((d) => d.ret);
  const m = mean(rets), s = std(rets);
  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  const annRet = Math.pow(eq, DAYS_PER_YEAR / n) - 1;
  const sharpe = s ? (m / s) * Math.sqrt(DAYS_PER_YEAR) : 0;
  const turnover = mean(daily.map((d) => d.turnover));
  // BRAIN-style fitness: Sharpe * sqrt(|returns| / max(turnover, 0.125)). Rewards returns, punishes churn.
  const fitness = sharpe * Math.sqrt(Math.abs(annRet) / Math.max(turnover, 0.125));
  return {
    days: n,
    total_return: eq - 1,
    annual_return: annRet,
    annual_vol: s * Math.sqrt(DAYS_PER_YEAR),
    sharpe, max_drawdown: mdd, turnover, fitness,
    win_rate: rets.filter((r) => r > 0).length / n,
  };
}

// The gates a strategy must pass before it can be listed (BRAIN-like submission checks).
export const GATES = [
  { key: 'sharpe', label: 'Sharpe ≥ 1.0', test: (s) => s.sharpe >= 1.0 },
  { key: 'fitness', label: 'Fitness ≥ 0.5', test: (s) => s.fitness >= 0.5 },
  { key: 'max_drawdown', label: 'Max drawdown better than −35%', test: (s) => s.max_drawdown > -0.35 },
  { key: 'turnover', label: 'Turnover ≤ 40% a day', test: (s) => s.turnover <= 0.4 },
  { key: 'oos', label: 'Out-of-sample Sharpe > 0', test: (s, r) => (r.out_of_sample?.sharpe ?? 0) > 0 },
];
export const checkGates = (r) => GATES.map((g) => ({ label: g.label, pass: !!g.test(r.stats, r) }));

// ---------- commitments ----------
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// The logic commitment: sha256(expression | settings | salt). A hidden strategy publishes only this hash.
// Anyone holding the expression + salt (the researcher, the auditor) can prove the live signals came from it.
export const logicCommit = (expression, settings, salt) => sha256Hex(`${expression.trim()}|${canonical({ ...DEFAULT_SETTINGS, ...settings })}|${salt}`);

export const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
