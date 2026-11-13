// The auditor run: test an agent's mainnet trades against its on-chain mandate,
// publish the report hash on-chain, and have NEAR AI Cloud write and sign the opinion letter.
//
// Usage: node scripts/auditor.mjs <agent.near> [--no-publish] [--no-letter]
import fs from 'fs';
import { audit, canonical, sha256Hex, OPINION_TEXT } from '../web/engine.js';
import { account, REGISTRY } from './near.mjs';

const agentId = process.argv[2] || 'alpha-bot-demo.near';
const flags = new Set(process.argv.slice(3));
const NEAR_AI = 'https://cloud-api.near.ai/v1';
const MODEL = process.env.TN_MODEL || 'deepseek-ai/DeepSeek-V4.1-Flash-1017';

const report = await audit(agentId, (m) => console.log('  ·', m));
console.log(`opinion: ${report.opinion} | trades tested ${report.trades.length} | findings ${report.findings.length}`);
console.log(`report hash: ${report.report_hash}`);

if (!flags.has('--no-publish')) {
  const reg = await account('top-notch');
  const pagesBase = process.env.TN_PAGES_URL || '';
  const r = await reg.functionCall({
    contractId: REGISTRY, methodName: 'publish_report',
    args: {
      agent: agentId, mandate_hash: report.mandate?.hash || '0'.repeat(64), report_hash: report.report_hash, opinion: report.opinion,
      trades_tested: report.trades.length, findings: report.findings.length, uri: pagesBase ? `${pagesBase}/?agent=${agentId}` : '',
    },
    gas: 30000000000000n,
  });
  report.publish_tx = r.transaction.hash;
  console.log(`report published on-chain, tx ${r.transaction.hash}`);
}

if (!flags.has('--no-letter')) {
  try {
    report.letter = await writeLetter(report);
    console.log('letter signed by NEAR AI Cloud:', report.letter.signing_address || '(no signing address)');
  } catch (e) {
    console.log('letter skipped:', e.message);
  }
}

const out = new URL(`../web/data/report-${agentId}.json`, import.meta.url);
fs.mkdirSync(new URL('../web/data/', import.meta.url), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`saved ${out.pathname}`);

async function writeLetter(report) {
  const facts = {
    agent: report.agent, opinion: OPINION_TEXT[report.opinion].label, report_hash: report.report_hash, mandate_hash: report.mandate?.hash,
    period: report.period, trades_tested: report.trades.length, findings: report.findings,
    mandate: report.mandate?.text ? JSON.parse(report.mandate.text) : null,
  };
  const body = {
    model: MODEL, temperature: 0, max_tokens: 3000,
    messages: [
      { role: 'system', content: 'You are the writer of an independent auditor\'s report on an AI trading agent. The opinion has ALREADY been decided by deterministic tests; you must state it exactly as given and never change it. Write in plain English, under 220 words, in this structure: "Opinion", "Basis for opinion", "Findings" (one line per finding, cite the trade number), "Scope and limits". Mention the report hash. No markdown tables.' },
      { role: 'user', content: canonical(facts) },
    ],
  };
  const res = await fetch(`${NEAR_AI}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(`NEAR AI ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const text = j.choices[0].message.content;
  if (!text.toLowerCase().includes(report.opinion === 'disclaimer' ? 'disclaimer' : report.opinion)) throw new Error('letter did not state the decided opinion; refusing to use it');
  const letter = { model: MODEL, chat_id: j.id, text, text_sha256: await sha256Hex(text) };
  // Signature and attestation from the TEE that ran the model.
  const sig = await fetch(`${NEAR_AI}/signature/${j.id}?model=${encodeURIComponent(MODEL)}&signing_algo=ecdsa`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  letter.signature = sig.signature || null;
  letter.signed_text = sig.text || null;
  letter.signing_address = sig.signing_address || null;
  const att = await fetch(`${NEAR_AI}/attestation/report?model=${encodeURIComponent(MODEL)}&signing_algo=ecdsa`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  letter.attestation_summary = att.error ? { error: att.error } : { signing_address: att.signing_address || att.model_attestations?.[0]?.signing_address || null, keys: Object.keys(att).slice(0, 8) };
  fs.writeFileSync(new URL(`../web/data/attestation-${report.agent}.json`, import.meta.url), JSON.stringify(att, null, 2));
  return letter;
}
