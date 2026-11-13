import { KeyPair } from 'near-api-js';
import fs from 'fs';
const kp = KeyPair.fromRandom('ed25519');
const pub = kp.getPublicKey();
const implicit = Buffer.from(pub.data).toString('hex');
const out = { account_id: implicit, public_key: pub.toString(), private_key: kp.toString(), note: 'Top Notch demo owner/treasury hot wallet. Demo funds only.' };
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2), { mode: 0o600 });
console.log(implicit);
