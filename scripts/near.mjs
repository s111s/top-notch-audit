// Shared NEAR helpers for the setup, agent and auditor scripts (Node).
import { connect, keyStores, KeyPair, utils } from 'near-api-js';
import fs from 'fs';
import path from 'path';

export const KEY_DIR = process.env.TN_KEY_DIR || '/mnt/project-files/top-notch/keys';
export const NETWORK = 'mainnet';
export const ONECLICK = 'https://1click.chaindefuser.com/v0';
export const USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const WNEAR = 'nep141:wrap.near';
export const SWEAT = 'nep141:token.sweat';
export const REGISTRY = 'top-notch.near';
export const AGENT = 'alpha-bot-demo.near';

export const parseNear = (n) => utils.format.parseNearAmount(String(n));
export const formatNear = (y) => utils.format.formatNearAmount(String(y), 4);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function loadKey(name) {
  return JSON.parse(fs.readFileSync(path.join(KEY_DIR, `${name}.json`), 'utf8'));
}

export function saveNewKey(name, accountId) {
  const file = path.join(KEY_DIR, `${name}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const kp = KeyPair.fromRandom('ed25519');
  const out = { account_id: accountId, public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
  fs.writeFileSync(file, JSON.stringify(out, null, 2), { mode: 0o600 });
  return out;
}

export async function account(name) {
  const k = loadKey(name);
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(NETWORK, k.account_id, KeyPair.fromString(k.private_key));
  const near = await connect({ networkId: NETWORK, keyStore, nodeUrl: 'https://rpc.mainnet.near.org' });
  return near.account(k.account_id);
}

export async function exists(near, accountId) {
  try { await (await near).account(accountId).state(); return true; } catch { return false; }
}

export async function oneclick(pathname, body) {
  const res = await fetch(`${ONECLICK}${pathname}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await res.json();
  if (!res.ok) throw new Error(`1Click ${pathname}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}
