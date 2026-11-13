// Pulls daily USD price + volume history for the strategy universe from GeckoTerminal (NEAR network,
// mostly NEAR Intents pools) and writes web/data/prices.json, aligned by date.
// Usage: node scripts/fetch-prices.mjs [days=365]
import fs from 'fs';

const GT = 'https://api.geckoterminal.com/api/v2/networks/near';
const DAYS = Number(process.argv[2] || 365);
// symbol -> GeckoTerminal token address on NEAR (the price source). `trade` = the NEP-141 the live agent swaps via 1Click.
export const UNIVERSE = [
  { sym: 'NEAR', gt: 'wrap.near', trade: 'nep141:wrap.near' },
  { sym: 'BTC', gt: 'nbtc.bridge.near', trade: 'nep141:nbtc.bridge.near' },
  { sym: 'ETH', gt: 'eth.omft.near', trade: 'nep141:eth.bridge.near' },
  { sym: 'SOL', gt: 'sol.omft.near' },
  { sym: 'ZEC', gt: 'zec.omft.near' },
  { sym: 'DOGE', gt: 'doge.omft.near' },
  { sym: 'XRP', gt: 'xrp.omft.near' },
  { sym: 'SUI', gt: 'sui.omft.near' },
  { sym: 'RHEA', gt: 'token.rhealab.near', trade: 'nep141:token.rhealab.near' },
  { sym: 'AURORA', gt: 'aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (r.status === 429) { await sleep(15000); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(`${r.status} ${url} ${JSON.stringify(j).slice(0, 200)}`);
    await sleep(2200); // stay under ~30 req/min
    return j;
  }
  throw new Error('rate limited: ' + url);
}

const series = {};
for (const t of UNIVERSE) {
  try {
    const pools = (await get(`${GT}/tokens/${t.gt}/pools?page=1&sort=h24_volume_usd_desc`)).data;
    // Prefer the oldest of the top-3 liquid pools so history is long.
    const top = pools.slice(0, 3).sort((a, b) => a.attributes.pool_created_at.localeCompare(b.attributes.pool_created_at))[0];
    const o = await get(`${GT}/pools/${top.attributes.address}/ohlcv/day?limit=${DAYS}&currency=usd&token=${encodeURIComponent(t.gt.startsWith('nep141:') ? t.gt : 'nep141:' + t.gt)}`).catch(async () =>
      get(`${GT}/pools/${top.attributes.address}/ohlcv/day?limit=${DAYS}&currency=usd&token=${top.relationships.base_token.data.id.endsWith(t.gt) ? 'base' : 'quote'}`));
    const rows = o.data.attributes.ohlcv_list; // [ts, o, h, l, c, v] newest first
    series[t.sym] = Object.fromEntries(rows.map((r) => [new Date(r[0] * 1000).toISOString().slice(0, 10), [r[4], r[5]]]));
    console.log(`${t.sym}: ${rows.length} days from pool ${top.attributes.name}`);
  } catch (e) { console.log(`${t.sym}: skipped (${e.message.slice(0, 120)})`); }
}

// Only complete daily candles: today's candle is still moving, so it is left out (keeps signals reproducible).
const today = new Date().toISOString().slice(0, 10);
const dates = [...new Set(Object.values(series).flatMap((s) => Object.keys(s)))].filter((d) => d < today).sort();
const out = { source: 'GeckoTerminal (NEAR network, NEAR Intents + Rhea pools), daily close in USD', fetched_at: new Date().toISOString(), dates, tokens: {} };
for (const [sym, s] of Object.entries(series)) {
  out.tokens[sym] = { close: dates.map((d) => s[d]?.[0] ?? null), volume: dates.map((d) => s[d]?.[1] ?? null), trade: UNIVERSE.find((u) => u.sym === sym).trade || null };
}
fs.mkdirSync(new URL('../web/data/', import.meta.url), { recursive: true });
const text = JSON.stringify(out);
fs.writeFileSync(new URL('../web/data/prices.json', import.meta.url), text);
// Dated snapshot: a signal published on-chain names the snapshot (and its sha256) it was computed from.
fs.mkdirSync(new URL('../web/data/snapshots/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`../web/data/snapshots/prices-${dates.at(-1)}.json`, import.meta.url), text);
console.log(`wrote ${dates.length} dates x ${Object.keys(out.tokens).length} tokens`);
