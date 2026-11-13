// One-time mainnet setup, paid by the funded owner wallet:
//  1. create top-notch.near (registry + auditor) and deploy the contract
//  2. create alpha-bot-demo.near (the demo trading agent)
// Safe to re-run: every step checks whether it is already done.
import fs from 'fs';
import { account, saveNewKey, parseNear, formatNear, REGISTRY, AGENT } from './near.mjs';

const owner = await account('owner');
const bal = await owner.getAccountBalance();
console.log(`owner ${owner.accountId} available ${formatNear(bal.available)} NEAR`);

async function ensureAccount(name, accountId, nearAmount) {
  const k = saveNewKey(name, accountId);
  try { await owner.connection.provider.query({ request_type: 'view_account', finality: 'final', account_id: accountId }); console.log(`${accountId} exists`); return; } catch {}
  console.log(`creating ${accountId} with ${nearAmount} NEAR`);
  const r = await owner.functionCall({ contractId: 'near', methodName: 'create_account', args: { new_account_id: accountId, new_public_key: k.public_key }, gas: 100000000000000n, attachedDeposit: BigInt(parseNear(nearAmount)) });
  console.log(`  tx ${r.transaction.hash}`);
}

await ensureAccount('top-notch', REGISTRY, process.env.TN_REGISTRY_NEAR || '1.7');
await ensureAccount('alpha-bot-demo', AGENT, process.env.TN_AGENT_NEAR || '3.5');

const reg = await account('top-notch');
const state = await reg.state();
if (state.code_hash === '11111111111111111111111111111111') {
  const wasm = fs.readFileSync(new URL('../contract/top_notch_registry.wasm', import.meta.url));
  const d = await reg.deployContract(wasm);
  console.log(`deployed registry, tx ${d.transaction.hash}`);
  const i = await reg.functionCall({ contractId: REGISTRY, methodName: 'new', args: { auditor: REGISTRY }, gas: 30000000000000n });
  console.log(`initialised, tx ${i.transaction.hash}`);
} else {
  console.log(`registry code already deployed (${state.code_hash})`);
}
console.log('auditor =', await reg.viewFunction({ contractId: REGISTRY, methodName: 'get_auditor' }));
