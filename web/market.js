// Reads the marketplace straight from the registry on NEAR mainnet: strategy cards, signals,
// auditor reports, and the investor agents that follow each strategy.
import { viewCall, listAuditedAgents, CONFIG } from './engine.js';

// Used when the NearBlocks index is rate-limited. Anyone who publishes to the registry also shows up via NearBlocks.
export const KNOWN_ACCOUNTS = ['researcher-1.top-notch.near', 'alpha-bot-demo.near'];

const parse = (m) => { let json = null; try { json = JSON.parse(m.mandate); } catch {} return { json, hash: m.mandate_hash, ms: Number(BigInt(m.timestamp_ns) / 1000000n), block_height: m.block_height }; };

export async function loadMarket() {
  let accounts = KNOWN_ACCOUNTS;
  try { const l = await listAuditedAgents(); if (l.length) accounts = [...new Set([...l, ...KNOWN_ACCOUNTS])]; } catch {}
  const entries = {}, reports = {};
  await Promise.all(accounts.map(async (a) => {
    entries[a] = (await viewCall(CONFIG.registry, 'get_mandates', { agent: a }).catch(() => [])).map(parse);
    reports[a] = await viewCall(CONFIG.registry, 'get_reports', { agent: a }).catch(() => []);
  }));
  const strategies = [];
  const followers = [];
  for (const a of accounts) {
    const es = entries[a];
    const cards = {};
    for (const e of es) if (e.json?.kind === 'strategy') cards[e.json.id] = e; // latest card per id wins
    for (const [id, card] of Object.entries(cards)) {
      const signals = es.filter((e) => e.json?.kind === 'signal' && e.json.id === id);
      const audit = reports[a].filter((r) => r.mandate_hash === card.hash).at(-1) || null;
      strategies.push({ account: a, id, card, signals, audit });
    }
    const own = es.filter((e) => e.json && !['strategy', 'signal'].includes(e.json.kind));
    const last = own.at(-1);
    if (last?.json?.kind === 'follow') followers.push({ agent: a, mandate: last, audit: reports[a].filter((r) => r.mandate_hash === last.hash).at(-1) || null });
  }
  for (const s of strategies) s.followers = followers.filter((f) => f.mandate.json.strategy.account === s.account && f.mandate.json.strategy.id === s.id);
  return { strategies, followers, accounts };
}

export const OPINION_LABEL = { clean: 'Clean', qualified: 'Qualified', adverse: 'Adverse', disclaimer: 'Disclaimer' };

// Small dependency-free SVG line chart. series: [{ points: [[label, y]...], cls }]
export function lineChart(series, { height = 220, split = null } = {}) {
  const W = 720, H = height, P = { l: 44, r: 10, t: 10, b: 24 };
  const xs = series[0].points.map((p) => p[0]);
  const ys = series.flatMap((s) => s.points.map((p) => p[1]));
  const min = Math.min(...ys), max = Math.max(...ys);
  const x = (i) => P.l + (i / Math.max(1, xs.length - 1)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - min) / (max - min || 1)) * (H - P.t - P.b);
  const ticks = [min, (min + max) / 2, max];
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of ticks) svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${((t - 1) * 100).toFixed(0)}%</text>`;
  if (split) { const i = xs.indexOf(split); if (i > 0) svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${P.t}" y2="${H - P.b}" stroke="var(--muted)" stroke-dasharray="4 4"/><text x="${x(i) + 4}" y="${P.t + 12}" font-size="11" fill="var(--muted)">out-of-sample →</text>`; }
  svg += `<text x="${P.l}" y="${H - 6}" font-size="11" fill="var(--muted)">${xs[0]}</text><text x="${W - P.r}" y="${H - 6}" font-size="11" fill="var(--muted)" text-anchor="end">${xs.at(-1)}</text>`;
  for (const s of series) svg += `<polyline fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" points="${s.points.map((p, i) => `${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}"/>`;
  return svg + '</svg>';
}
