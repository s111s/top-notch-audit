// NEAR AI Cloud writes the opinion letter inside a TEE and signs it. The opinion itself is decided
// by deterministic code before this is called; the letter must state it unchanged or it is rejected.
import fs from 'fs';
import { canonical, sha256Hex } from '../web/engine.js';

const NEAR_AI = 'https://cloud-api.near.ai/v1';
export const MODEL = process.env.TN_MODEL || 'deepseek-ai/DeepSeek-V4.1-Flash-1017';

export async function writeLetter({ facts, system, mustInclude, attestationFile }) {
  const body = { model: MODEL, temperature: 0, max_tokens: 3000, messages: [{ role: 'system', content: system }, { role: 'user', content: canonical(facts) }] };
  const res = await fetch(`${NEAR_AI}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(`NEAR AI ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const text = j.choices[0].message.content;
  if (!text.toLowerCase().includes(mustInclude)) throw new Error('letter did not state the decided opinion; refusing to use it');
  const letter = { model: MODEL, chat_id: j.id, text, text_sha256: await sha256Hex(text) };
  const sig = await fetch(`${NEAR_AI}/signature/${j.id}?model=${encodeURIComponent(MODEL)}&signing_algo=ecdsa`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  letter.signature = sig.signature || null;
  letter.signed_text = sig.text || null;
  letter.signing_address = sig.signing_address || null;
  const att = await fetch(`${NEAR_AI}/attestation/report?model=${encodeURIComponent(MODEL)}&signing_algo=ecdsa`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  letter.attestation_summary = att.error ? { error: att.error } : { signing_address: att.signing_address || att.model_attestations?.[0]?.signing_address || null, keys: Object.keys(att).slice(0, 8) };
  if (attestationFile) fs.writeFileSync(attestationFile, JSON.stringify(att, null, 2));
  return letter;
}
