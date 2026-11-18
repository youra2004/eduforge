import { generateSigningKey } from '../src/certificate/keys';

// Usage: pnpm generate-signing-key
// Prints a new Ed25519 key for certificates. Put the CERT_SIGNING_KEY line in your secret store or .env; it is never saved anywhere else.
const key = generateSigningKey();
console.log(`# kid ${key.kid} (public key ${key.publicKey})`);
console.log(`CERT_SIGNING_KEY=${key.privateKey}`);
