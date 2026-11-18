import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

export interface SigningKey {
  kid: string;
  /** Raw 32-byte public key, base64url (the `x` of its JWK). */
  publicKey: string;
  sign(input: Buffer): string;
}

const publicKeyOf = (key: KeyObject) => {
  const jwk = createPublicKey(key).export({ format: 'jwk' });
  return jwk.x as string;
};

/** The key id is derived from the public key, so a key and its id cannot drift apart. */
export const kidOf = (publicKey: string) =>
  createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('base64url').slice(0, 16);

/** A new Ed25519 key pair for `pnpm generate-signing-key`. The private part goes to env, never to the DB. */
export function generateSigningKey() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const publicKey = publicKeyOf(privateKey);
  return {
    kid: kidOf(publicKey),
    publicKey,
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

/** Loads the private key from env (PKCS#8 DER, base64). Throws when it is not an Ed25519 key. */
export function loadSigningKey(privateKeyB64: string): SigningKey {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyB64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  if (key.asymmetricKeyType !== 'ed25519')
    throw new Error('CERT_SIGNING_KEY is not an Ed25519 key');
  const publicKey = publicKeyOf(key);
  return {
    kid: kidOf(publicKey),
    publicKey,
    sign: (input) => sign(null, input, key).toString('base64url'),
  };
}

/** True when `signature` (base64url) is a valid Ed25519 signature of `input` by `publicKey` (raw, base64url). */
export function verifySignature(publicKey: string, input: Buffer, signature: string): boolean {
  try {
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: publicKey },
      format: 'jwk',
    });
    return verify(null, input, key, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}
