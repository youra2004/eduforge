import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assessments,
  certificates,
  courseVersions,
  createDb,
  eventLog,
  llmRuns,
  signingKeys,
  strikes,
  users,
  type ExamSkillResult,
} from '@eduforge/db';
import { DrizzleLLMRunStore, LLMClient, MockLLMProvider } from '@eduforge/llm';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth/guard';
import { CourseError } from '../courses/errors';
import { importCourse } from '../courses/service';
import { examSettings } from '../exam/service';
import { reviewSoftStrike } from '../proctor/strikes';
import { sha256Hex, signingInput } from './canonical';
import { generateSigningKey, loadSigningKey } from './keys';
import {
  getPublicCertificate,
  issueCertificate,
  listCertificates,
  listOwnCertificates,
  listPublicKeys,
  registerSigningKey,
  revokeCertificate,
} from './service';
import { certificateMockResponders } from './summary';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

const demo = JSON.parse(
  readFileSync(new URL('../../seed/demo-course.json', import.meta.url), 'utf8'),
);
const mock = new MockLLMProvider(certificateMockResponders);
const llm = new LLMClient(mock, new DrizzleLLMRunStore(db));
const key = loadSigningKey(generateSigningKey().privateKey);
const T0 = new Date('2026-03-01T10:00:00Z');

let n = 0;
async function makeUser(roles: AuthUser['roles'], name = 'Олена Коваль'): Promise<AuthUser> {
  const email = `cert-test-${Date.now()}-${n++}@test.local`;
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: name })
    .returning();
  return { id: row!.id, email, displayName: name, roles };
}

const skills: ExamSkillResult[] = [
  { skillId: 's1', name: 'Обхід графа', pct: 95, level: 'perfect' },
  { skillId: 's2', name: 'Найкоротший шлях', pct: 75, level: 'good' },
];

/** A published, rated course and a student with a finished exam attempt (status picked by the test). */
async function setup(status: 'passed' | 'failed' | 'annulled' = 'passed') {
  const author = await makeUser(['author']);
  const { versionId } = await importCourse(
    db,
    { ...structuredClone(demo), slug: `cert-${Date.now()}-${n++}` },
    author.id,
  );
  await db
    .update(courseVersions)
    .set({ status: 'published', rating: 4 })
    .where(eq(courseVersions.id, versionId));
  const student = await makeUser(['student']);
  const [exam] = await db
    .insert(assessments)
    .values({
      userId: student.id,
      kind: 'exam',
      courseVersionId: versionId,
      status,
      scorePct: 85.04,
      perSkill: skills,
      questionSetSeed: 1,
      submittedAt: T0,
    })
    .returning();
  return { student, versionId, examId: exam!.id };
}

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof CourseError) return err.code;
    throw err;
  }
  return 'ok';
}

describe('issuance (F10-R1, F10-R2)', () => {
  it('signs the payload, registers the key, logs the LLM call and the event', async () => {
    const { student, examId } = await setup();
    const issued = await issueCertificate(db, llm, student, examId, { key, now: T0 });
    const [row] = await db.select().from(certificates).where(eq(certificates.id, issued.id));
    expect(row!.payload).toMatchObject({
      certificate_id: issued.id,
      holder_name: 'Олена Коваль',
      course: { version: 1 },
      rating: 4,
      score_pct: 85,
      issued_at: T0.toISOString(),
      kid: key.kid,
    });
    expect(row!.payload.skills).toEqual([
      { name: 'Обхід графа', level: 'perfect', pct: 95 },
      { name: 'Найкоротший шлях', level: 'good', pct: 75 },
    ]);
    expect(row!.payload.summary_text).toContain('Бездоганно засвоєно: Обхід графа.');
    expect(row!.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    const [stored] = await db.select().from(signingKeys).where(eq(signingKeys.kid, key.kid));
    expect(stored!.publicKey).toBe(key.publicKey);

    const runs = await db.select().from(llmRuns).where(eq(llmRuns.subjectId, examId));
    expect(runs.map((r) => r.purpose)).toEqual(['certificate_summary']);
    // The prompt carries levels only: no holder name, no email.
    expect(JSON.stringify(runs[0]!.request)).not.toContain('Коваль');
    expect(JSON.stringify(runs[0]!.request)).not.toContain(student.email);
    const events = await db
      .select()
      .from(eventLog)
      .where(and(eq(eventLog.userId, student.id), eq(eventLog.name, 'certificate_issued')));
    expect(events).toHaveLength(1);
  });

  it('is idempotent: a second call returns the same certificate and makes no new LLM call', async () => {
    const { student, examId } = await setup();
    const first = await issueCertificate(db, llm, student, examId, { key });
    const calls = mock.calls.length;
    const second = await issueCertificate(db, llm, student, examId, { key });
    expect(second.id).toBe(first.id);
    expect(mock.calls.length).toBe(calls);
    expect(await listOwnCertificates(db, student)).toHaveLength(1);
  });

  it('concurrent calls end with one certificate', async () => {
    const { student, examId } = await setup();
    const results = await Promise.all(
      [1, 2, 3].map(() => issueCertificate(db, llm, student, examId, { key })),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const rows = await db.select().from(certificates).where(eq(certificates.assessmentId, examId));
    expect(rows).toHaveLength(1);
  });

  it('only for a passed attempt of the caller, and only with a signing key', async () => {
    const failed = await setup('failed');
    expect(await code(issueCertificate(db, llm, failed.student, failed.examId, { key }))).toBe(
      'certificate_not_eligible',
    );
    const annulled = await setup('annulled');
    expect(await code(issueCertificate(db, llm, annulled.student, annulled.examId, { key }))).toBe(
      'certificate_not_eligible',
    );

    const ok = await setup();
    const other = await makeUser(['student']);
    expect(await code(issueCertificate(db, llm, other, ok.examId, { key }))).toBe(
      'assessment_not_found',
    );
    expect(await code(issueCertificate(db, llm, ok.student, 'nope', { key }))).toBe(
      'assessment_not_found',
    );
    expect(await code(issueCertificate(db, llm, ok.student, ok.examId, { key: null }))).toBe(
      'certificate_unavailable',
    );
    const rows = await db
      .select()
      .from(certificates)
      .where(eq(certificates.assessmentId, ok.examId));
    expect(rows).toHaveLength(0);
  });

  it('is held while a proctoring flag waits for an admin, and released when it is dismissed', async () => {
    const { student, examId } = await setup();
    const admin = await makeUser(['admin']);
    const [flag] = await db
      .insert(strikes)
      .values({
        userId: student.id,
        assessmentId: examId,
        reason: 'risk',
        status: 'pending_review',
      })
      .returning();
    expect(await code(issueCertificate(db, llm, student, examId, { key }))).toBe(
      'certificate_on_hold',
    );
    await reviewSoftStrike(db, admin, flag!.id, 'dismiss', {}, examSettings().proctor);
    expect(await code(issueCertificate(db, llm, student, examId, { key }))).toBe('ok');
  });
});

describe('public verification (F10-R3)', () => {
  it('works with no account and reports a valid signature and the status', async () => {
    const { student, examId } = await setup();
    const { id } = await issueCertificate(db, llm, student, examId, { key });
    const view = await getPublicCertificate(db, id);
    expect(view).toMatchObject({ id, signatureValid: true, status: 'valid', kid: key.kid });
    expect(view!.payload.holder_name).toBe('Олена Коваль');
    expect(JSON.stringify(view)).not.toContain(student.email);
    expect(await getPublicCertificate(db, 'not-a-uuid')).toBeNull();
    expect(await getPublicCertificate(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('a payload changed in the database is reported as an invalid signature', async () => {
    const { student, examId } = await setup();
    const { id } = await issueCertificate(db, llm, student, examId, { key });
    const [row] = await db.select().from(certificates).where(eq(certificates.id, id));
    await db
      .update(certificates)
      .set({ payload: { ...row!.payload, score_pct: 100 } })
      .where(eq(certificates.id, id));
    // `status` never says valid for a certificate that fails the check.
    expect(await getPublicCertificate(db, id)).toMatchObject({
      signatureValid: false,
      status: 'invalid',
    });
  });

  it('a payload and hash both rewritten by someone without the key still fail on the signature', async () => {
    const { student, examId } = await setup();
    const { id } = await issueCertificate(db, llm, student, examId, { key });
    const [row] = await db.select().from(certificates).where(eq(certificates.id, id));
    const forged = { ...row!.payload, holder_name: 'Хтось Інший' };
    await db
      .update(certificates)
      .set({ payload: forged, payloadSha256: sha256Hex(signingInput(forged)) })
      .where(eq(certificates.id, id));
    expect(await getPublicCertificate(db, id)).toMatchObject({ signatureValid: false });
  });

  it('a stored hash that does not match the payload is reported too', async () => {
    const { student, examId } = await setup();
    const { id } = await issueCertificate(db, llm, student, examId, { key });
    await db
      .update(certificates)
      .set({ payloadSha256: '0'.repeat(64) })
      .where(eq(certificates.id, id));
    expect(await getPublicCertificate(db, id)).toMatchObject({ signatureValid: false });
  });

  it('the public key by kid is served and an independent script verifies the signature with it', async () => {
    const { student, examId } = await setup();
    const { id } = await issueCertificate(db, llm, student, examId, { key });
    await registerSigningKey(db, key);
    const jwks = await listPublicKeys(db);
    expect(jwks.find((k) => k.kid === key.kid)).toMatchObject({
      kty: 'OKP',
      crv: 'Ed25519',
      x: key.publicKey,
    });
    const view = await getPublicCertificate(db, id);
    const dir = mkdtempSync(join(tmpdir(), 'cert-verify-'));
    const certFile = join(dir, 'certificate.json');
    const jwksFile = join(dir, 'jwks.json');
    writeFileSync(certFile, JSON.stringify(view));
    writeFileSync(jwksFile, JSON.stringify({ keys: jwks }));
    const script = new URL('../../../../scripts/verify-certificate.mjs', import.meta.url).pathname;
    const run = () =>
      execFileSync('node', [script, '--files', certFile, jwksFile], { encoding: 'utf8' });
    const out = run();
    expect(out).toContain('signature: valid');
    expect(out).toContain('sha-256:   matches');

    // The same script rejects a changed field.
    writeFileSync(
      certFile,
      JSON.stringify({ ...view, payload: { ...view!.payload, score_pct: 100 } }),
    );
    expect(run).toThrow(/Command failed/);
  });

  it('a retired key stays in the key set and still verifies what it signed', async () => {
    const { student, examId } = await setup();
    const { id } = await issueCertificate(db, llm, student, examId, { key });
    const next = loadSigningKey(generateSigningKey().privateKey);
    await registerSigningKey(db, next);
    const jwks = await listPublicKeys(db);
    expect(jwks.find((k) => k.kid === key.kid)).toHaveProperty('retired_at');
    expect(jwks.find((k) => k.kid === next.kid)).not.toHaveProperty('retired_at');
    expect(await getPublicCertificate(db, id)).toMatchObject({ signatureValid: true });
    // Back in use: active again, and the other one is retired.
    await registerSigningKey(db, key);
    const back = await listPublicKeys(db);
    expect(back.find((k) => k.kid === key.kid)).not.toHaveProperty('retired_at');
    expect(back.find((k) => k.kid === next.kid)).toHaveProperty('retired_at');
  });
});

describe('revocation (F10-R4)', () => {
  it('an admin revokes with a reason and the certificate is shown as revoked', async () => {
    const { student, examId } = await setup();
    const admin = await makeUser(['admin']);
    const { id } = await issueCertificate(db, llm, student, examId, { key });
    expect(await code(revokeCertificate(db, admin, id, { reason: ' ' }))).toBe(
      'invalid_revocation',
    );
    expect(await code(revokeCertificate(db, admin, 'nope', { reason: 'Помилка' }))).toBe(
      'certificate_not_found',
    );
    await revokeCertificate(db, admin, id, { reason: 'Порушення правил іспиту' }, T0);
    const view = await getPublicCertificate(db, id);
    expect(view).toMatchObject({ status: 'revoked', signatureValid: true, revokedAt: T0 });
    // The reason is for admins; the public record has none.
    expect(JSON.stringify(view)).not.toContain('Порушення правил');
    const [listed] = (await listCertificates(db, admin)).filter((c) => c.id === id);
    expect(listed!.revokeReason).toBe('Порушення правил іспиту');
    expect(await code(revokeCertificate(db, admin, id, { reason: 'Ще раз' }))).toBe(
      'invalid_certificate_state',
    );
  });

  it('only an admin can revoke or list', async () => {
    const { student, examId } = await setup();
    const { id } = await issueCertificate(db, llm, student, examId, { key });
    await expect(revokeCertificate(db, student, id, { reason: 'Хочу' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(revokeCertificate(db, null, id, { reason: 'Хочу' })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(listCertificates(db, student)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a confirmed strike annuls the pass and revokes its certificate', async () => {
    const { student, examId } = await setup();
    const admin = await makeUser(['admin']);
    const { id } = await issueCertificate(db, llm, student, examId, { key });
    const [flag] = await db
      .insert(strikes)
      .values({
        userId: student.id,
        assessmentId: examId,
        reason: 'risk',
        status: 'pending_review',
      })
      .returning();
    await reviewSoftStrike(db, admin, flag!.id, 'confirm', {}, examSettings().proctor, T0);
    expect(await getPublicCertificate(db, id)).toMatchObject({ status: 'revoked' });
    const [row] = await db.select().from(certificates).where(eq(certificates.id, id));
    expect(row!.revokeReason).toContain('proctor_violation');
  });
});

describe('an exam resumed after an interruption (F8-R6, ADR-0013)', () => {
  /** The attempt the strike is about, and a later attempt resumed from it that passed. */
  async function resumedPair() {
    const { student, versionId, examId: first } = await setup('annulled');
    const [second] = await db
      .insert(assessments)
      .values({
        userId: student.id,
        kind: 'exam',
        courseVersionId: versionId,
        attemptNo: 2,
        status: 'passed',
        scorePct: 80,
        perSkill: skills,
        questionSetSeed: 2,
        submittedAt: T0,
        meta: { resumedFrom: first },
      })
      .returning();
    return { student, first, second: second!.id };
  }

  it('a flag on the earlier attempt holds the certificate of the resumed one', async () => {
    const { student, first, second } = await resumedPair();
    const admin = await makeUser(['admin']);
    const [flag] = await db
      .insert(strikes)
      .values({ userId: student.id, assessmentId: first, reason: 'risk', status: 'pending_review' })
      .returning();
    expect(await code(issueCertificate(db, llm, student, second, { key }))).toBe(
      'certificate_on_hold',
    );
    await reviewSoftStrike(db, admin, flag!.id, 'dismiss', {}, examSettings().proctor);
    expect(await code(issueCertificate(db, llm, student, second, { key }))).toBe('ok');
  });

  it('a confirmed strike on the earlier attempt refuses the resumed one and revokes an issued certificate', async () => {
    const { student, first, second } = await resumedPair();
    const admin = await makeUser(['admin']);
    const [flag] = await db
      .insert(strikes)
      .values({ userId: student.id, assessmentId: first, reason: 'risk', status: 'pending_review' })
      .returning();
    // Issued before the flag came in (the flag was added after the pass).
    await db.delete(strikes).where(eq(strikes.id, flag!.id));
    const { id } = await issueCertificate(db, llm, student, second, { key });
    const [again] = await db
      .insert(strikes)
      .values({ userId: student.id, assessmentId: first, reason: 'risk', status: 'pending_review' })
      .returning();
    await reviewSoftStrike(db, admin, again!.id, 'confirm', {}, examSettings().proctor, T0);
    expect(await getPublicCertificate(db, id)).toMatchObject({ status: 'revoked' });

    const other = await resumedPair();
    await db.insert(strikes).values({
      userId: other.student.id,
      assessmentId: other.first,
      reason: 'x',
      status: 'confirmed',
    });
    expect(await code(issueCertificate(db, llm, other.student, other.second, { key }))).toBe(
      'certificate_not_eligible',
    );
  });
});
