import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { proctorEvidence, type Db } from '@eduforge/db';
import { inArray, lt } from 'drizzle-orm';
import { CourseError } from '../courses/errors';

/** Evidence files are named by us; anything else never reaches the file system. */
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.enc$/;

const evidencePath = (storageDir: string, key: string) => {
  if (!keyPattern.test(key)) throw new CourseError('media_not_found');
  return join(storageDir, 'evidence', key);
};

/** AES-256-GCM: `iv (12) | tag (16) | ciphertext`. A frame leaves memory only in this form (F9-R7, NFR-2). */
export function encryptFrame(keyHex: string, frame: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const body = Buffer.concat([cipher.update(frame), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptFrame(keyHex: string, blob: Buffer): Buffer {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyHex, 'hex'),
    blob.subarray(0, 12),
  );
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

/** Stores the frame of a triggered event, encrypted, with a lifetime. Returns the row's values for the caller to insert. */
export async function storeEvidence(
  storageDir: string,
  keyHex: string | undefined,
  frame: Buffer,
  expiresAt: Date,
) {
  if (!keyHex) throw new Error('EVIDENCE_KEY is not set: evidence frames cannot be stored');
  const dir = join(storageDir, 'evidence');
  await mkdir(dir, { recursive: true });
  const storageKey = `${randomUUID()}.enc`;
  await writeFile(join(dir, storageKey), encryptFrame(keyHex, frame));
  return {
    storageKey,
    sha256: createHash('sha256').update(frame).digest('hex'),
    expiresAt,
  };
}

export async function readEvidence(storageDir: string, keyHex: string | undefined, key: string) {
  if (!keyHex) throw new Error('EVIDENCE_KEY is not set');
  try {
    return decryptFrame(keyHex, await readFile(evidencePath(storageDir, key)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new CourseError('media_not_found');
    throw err;
  }
}

/** Removes evidence files by key; a file already gone is not an error. */
export async function removeEvidenceFiles(storageDir: string, keys: string[]) {
  for (const key of keys) await rm(evidencePath(storageDir, key), { force: true });
}

/** Deletes evidence rows with their files. A file already gone is not an error. */
async function deleteRows(db: Db, rows: { id: string; storageKey: string }[], storageDir: string) {
  await removeEvidenceFiles(
    storageDir,
    rows.map((r) => r.storageKey),
  );
  if (rows.length) {
    await db.delete(proctorEvidence).where(
      inArray(
        proctorEvidence.id,
        rows.map((r) => r.id),
      ),
    );
  }
  return rows.length;
}

/** The retention job (F9-R7, DATA_MODEL §14): removes evidence whose `expires_at` has passed, files included. */
export async function purgeExpiredEvidence(db: Db, storageDir: string, now = new Date()) {
  const rows = await db
    .select({ id: proctorEvidence.id, storageKey: proctorEvidence.storageKey })
    .from(proctorEvidence)
    .where(lt(proctorEvidence.expiresAt, now));
  return deleteRows(db, rows, storageDir);
}

/** Removes the evidence of events of one strike once its case is closed (dismissed, overturned, appeal decided). */
export async function purgeEvidenceOfEvents(db: Db, storageDir: string, eventIds: string[]) {
  if (eventIds.length === 0) return 0;
  const rows = await db
    .select({ id: proctorEvidence.id, storageKey: proctorEvidence.storageKey })
    .from(proctorEvidence)
    .where(inArray(proctorEvidence.eventId, eventIds));
  return deleteRows(db, rows, storageDir);
}
