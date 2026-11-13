// Managed-agent vaults. Each investor gets their own NEAR account running the vault contract.
// Only the investor's key controls the account; the platform's agent can only call `swap` within the policy.
//
// Usage:
//   node scripts/vault.mjs create            create vault-1.top-notch.near with the INVESTOR's key, deploy + init
//   node scripts/vault.mjs fund <usdc>       investor sends USDC into their vault
//   node scripts/vault.mjs status            balances, policy, agent
import fs from 'fs';
import { account, parseNear, REGISTRY, AGENT, USDC, loadKey } from './near.mjs';
import { KeyPair } from 'near-api-js';

export const VAULT = 'vault-1.top-notch.near';
// The investor's own wallet (implicit account). Only its key controls the vault; the platform never needs it.
export const INVESTOR = 'f9f6f5f3cc4ae3308f7b26d58f3ed945f0857a2848043059614226b008d93180';
const GAS = 100000000000000n;

export const POLICY = {
  strategy: 'researcher-1.top-notch.near/dip-in-uptrend',
  max_trades_per_day: 10,
  tokens: [
    { token: USDC.slice(7), max_per_trade: '5000000' }, // 5 USDC
    { token: 'wrap.near', max_per_trade: parseNear('1.5') }, // ~$5
    { token: 'token.rhealab.near', max_per_trade: (150n * 10n ** 18n).toString() },
    { token: 'aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near', max_per_trade: (150n * 10n ** 18n).toString() },
    { token: 'nbtc.bridge.near', max_per_trade: '8000' }, // 0.00008 BTC
    { token: 'eth.bridge.near', max_per_trade: (26n * 10n ** 14n).toString() }, // 0.0026 ETH
  ],
};

async function create() {
  const platform = await account('top-notch');
  const investorKey = KeyPair.fromString(loadKey('owner').private_key).getPublicKey();
  const exists = await platform.connection.provider.query({ request_type: 'view_account', finality: 'final', account_id: VAULT }).catch(() => null);
  if (!exists) {
    // The platform pays for the account, but the ONLY full-access key on it is the investor's.
    const r = await platform.createAccount(VAULT, investorKey, BigInt(parseNear('1.5')));
    console.log(`created ${VAULT} (investor key only), tx ${r.transaction.hash}`);
  }
  // The investor deploys and initialises their own vault.
  const vaultAsInvestor = await account('owner');
  const asVault = vaultAsInvestor.connection;
  const { connect, keyStores } = await import('near-api-js');
  const ks = new keyStores.InMemoryKeyStore();
  await ks.setKey('mainnet', VAULT, KeyPair.fromString(loadKey('owner').private_key));
  const near = await connect({ networkId: 'mainnet', keyStore: ks, nodeUrl: 'https://rpc.mainnet.near.org' });
  const v = await near.account(VAULT);
  const code = fs.readFileSync(new URL('../vault/top_notch_vault.wasm', import.meta.url));
  const d = await v.deployContract(code);
  console.log(`deployed vault code, tx ${d.transaction.hash}`);
  const i = await v.functionCall({ contractId: VAULT, methodName: 'new', args: { owner: INVESTOR, agent: AGENT, policy: POLICY }, gas: GAS });
  console.log(`initialised: owner ${INVESTOR.slice(0, 10)}…, agent ${AGENT}, tx ${i.transaction.hash}`);
  void asVault;
}

async function ensureStorage(acct, contract, accountId) {
  const s = await acct.viewFunction({ contractId: contract, methodName: 'storage_balance_of', args: { account_id: accountId } }).catch(() => null);
  if (s) return;
  await acct.functionCall({ contractId: contract, methodName: 'storage_deposit', args: { account_id: accountId, registration_only: true }, gas: 30000000000000n, attachedDeposit: 1250000000000000000000n });
}

async function fund(usdc) {
  const inv = await account('owner');
  const agent = await account('alpha-bot-demo');
  await ensureStorage(agent, USDC.slice(7), VAULT);
  const amount = BigInt(Math.round(Number(usdc) * 1e6)).toString();
  const r = await inv.functionCall({ contractId: USDC.slice(7), methodName: 'ft_transfer', args: { receiver_id: VAULT, amount, memo: 'fund vault' }, gas: 30000000000000n, attachedDeposit: 1n });
  console.log(`investor funded vault with ${usdc} USDC, tx ${r.transaction.hash}`);
}

async function status() {
  const a = await account('alpha-bot-demo');
  console.log('owner', await a.viewFunction({ contractId: VAULT, methodName: 'get_owner' }));
  console.log('agent', await a.viewFunction({ contractId: VAULT, methodName: 'get_agent' }));
  console.log('swaps', await a.viewFunction({ contractId: VAULT, methodName: 'get_swap_count' }));
  for (const t of POLICY.tokens) console.log(t.token.slice(0, 20), await a.viewFunction({ contractId: t.token, methodName: 'ft_balance_of', args: { account_id: VAULT } }).catch(() => 'n/a'));
  const keys = await a.connection.provider.query({ request_type: 'view_access_key_list', finality: 'final', account_id: VAULT });
  console.log('access keys on vault:', keys.keys.map((k) => `${k.public_key.slice(0, 16)}… ${k.access_key.permission === 'FullAccess' ? 'FullAccess' : 'FunctionCall'}`).join(', '));
}

const [cmd, arg] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (cmd === 'create') await create();
  else if (cmd === 'fund') await fund(arg);
  else if (cmd === 'status') await status();
  else console.log('usage: vault.mjs create | fund <usdc> | status');
}
void REGISTRY;
