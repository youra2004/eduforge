#!/usr/bin/env node
// Verifies an EduForge certificate with Node's crypto only: nothing from this repository is imported (F10-R2).
//
//   node scripts/verify-certificate.mjs <base-url> <certificate-id>
//   node scripts/verify-certificate.mjs --files <certificate.json> <jwks.json>
//
// It reads GET <base>/api/certificates/<id> and GET <base>/.well-known/jwks.json, rebuilds the signing input
// (JSON with object keys sorted at every level, no whitespace), and checks the Ed25519 signature and the SHA-256.
// Exit code 0 = signature valid (and not revoked), 1 = invalid or revoked, 2 = usage / network error.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const canonical = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
};

async function load(args) {
  if (args[0] === '--files' && args.length === 3) {
    return args.slice(1).map((f) => JSON.parse(readFileSync(f, 'utf8')));
  }
  if (args.length === 2) {
    const [base, id] = args;
    const get = async (path) => {
      const res = await fetch(new URL(path, base));
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return res.json();
    };
    return [await get(`/api/certificates/${id}`), await get('/.well-known/jwks.json')];
  }
  throw new Error(
    'usage: verify-certificate.mjs <base-url> <id> | --files <certificate.json> <jwks.json>',
  );
}

try {
  const [cert, jwks] = await load(process.argv.slice(2));
  const jwk = jwks.keys.find((k) => k.kid === cert.kid);
  if (!jwk) throw new Error(`no public key with kid ${cert.kid}`);
  const input = Buffer.from(canonical(cert.payload), 'utf8');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
  const signatureOk = verify(null, input, key, Buffer.from(cert.signature, 'base64url'));
  const hashOk = createHash('sha256').update(input).digest('hex') === cert.payloadSha256;
  const bound = cert.payload.kid === cert.kid;
  console.log(`certificate ${cert.payload.certificate_id}  kid ${cert.kid}`);
  console.log(`  signature: ${signatureOk ? 'valid' : 'INVALID'}`);
  console.log(`  sha-256:   ${hashOk ? 'matches' : 'MISMATCH'}`);
  console.log(`  status:    ${cert.status}`);
  process.exit(signatureOk && hashOk && bound && cert.status === 'valid' ? 0 : 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
}
