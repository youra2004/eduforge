import { randomUUID } from 'node:crypto';
import {
  assessments,
  certificates,
  courseVersions,
  signingKeys,
  strikes,
  users,
  type Certificate,
  type CertificatePayload,
  type Db,
  type ExamSkillResult,
} from '@eduforge/db';
import type { LLMClient } from '@eduforge/llm';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/guard';
import { requireRole } from '../auth/guard';
import { loadConfig } from '../config';
import { CourseError } from '../courses/errors';
import type { Tx } from '../courses/service';
import { logEvent } from '../learning/events';
import { sha256Hex, signingInput } from './canonical';
import { loadSigningKey, verifySignature, type SigningKey } from './keys';
import { generateSummary } from './summary';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The active signing key from env, or null when none is configured (then nothing can be issued). */
export function activeSigningKey(config = loadConfig()): SigningKey | null {
  return config.certificate.signingKey ? loadSigningKey(config.certificate.signingKey) : null;
}

/** Puts the active public key in `signing_keys` and retires the others. Old keys stay: they still verify old certificates. */
export async function registerSigningKey(db: Db | Tx, key: SigningKey, now = new Date()) {
  await db
    .insert(signingKeys)
    .values({ kid: key.kid, publicKey: key.publicKey, createdAt: now })
    .onConflictDoNothing();
  // A key that comes back into use (rotated back, or a restored env) is active again.
  await db.update(signingKeys).set({ retiredAt: null }).where(eq(signingKeys.kid, key.kid));
  await db
    .update(signingKeys)
    .set({ retiredAt: now })
    .where(and(ne(signingKeys.kid, key.kid), isNull(signingKeys.retiredAt)));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** F10-R1: the signed content. Names and levels come from the stored exam result, the text from the LLM. */
export function buildPayload(input: {
  certificateId: string;
  holderName: string;
  course: { id: string; version: number; title: string };
  rating: number | null;
  scorePct: number;
  issuedAt: Date;
  perSkill: Pick<ExamSkillResult, 'name' | 'level' | 'pct'>[];
  summary: string;
  kid: string;
}): CertificatePayload {
  return {
    certificate_id: input.certificateId,
    holder_name: input.holderName,
    course: input.course,
    rating: input.rating,
    score_pct: round1(input.scorePct),
    issued_at: input.issuedAt.toISOString(),
    skills: input.perSkill.map((s) => ({ name: s.name, level: s.level, pct: round1(s.pct) })),
    summary_text: input.summary,
    kid: input.kid,
  };
}

/** Signs a payload; the SHA-256 is for display (F10-R2). */
export function signPayload(payload: CertificatePayload, key: SigningKey) {
  const input = signingInput(payload);
  return { payloadSha256: sha256Hex(input), signature: key.sign(input) };
}

const certView = (c: Certificate) => ({
  id: c.id,
  courseVersionId: c.courseVersionId,
  title: c.payload.course.title,
  issuedAt: c.issuedAt,
  revoked: c.revokedAt !== null,
});
export type CertificateSummary = ReturnType<typeof certView>;

async function loadExam(db: Db | Tx, examId: string) {
  if (!UUID.test(examId)) return null;
  const [row] = await db
    .select({
      a: assessments,
      title: courseVersions.title,
      versionNo: courseVersions.versionNo,
      rating: courseVersions.rating,
      courseId: courseVersions.courseId,
      holder: users.displayName,
    })
    .from(assessments)
    .innerJoin(courseVersions, eq(courseVersions.id, assessments.courseVersionId))
    .innerJoin(users, eq(users.id, assessments.userId))
    .where(and(eq(assessments.id, examId), eq(assessments.kind, 'exam')));
  return row ?? null;
}

/** A pending soft flag holds the certificate until an admin decides (ADR-0013). */
async function holdCheck(db: Db | Tx, assessmentId: string) {
  const [flag] = await db
    .select({ id: strikes.id })
    .from(strikes)
    .where(and(eq(strikes.assessmentId, assessmentId), eq(strikes.status, 'pending_review')));
  if (flag) throw new CourseError('certificate_on_hold');
}

/**
 * F10: issues the certificate of the student's passed exam. Idempotent: the second call returns the first
 * certificate. Refused while the attempt is not a pass, while a proctoring flag waits for an admin, or when no
 * signing key is configured. The LLM description is made first, outside the transaction.
 */
export async function issueCertificate(
  db: Db,
  llm: LLMClient,
  user: AuthUser | null,
  examId: string,
  opts: { key?: SigningKey | null; now?: Date } = {},
): Promise<CertificateSummary> {
  const actor = requireRole(user, 'student', 'author', 'expert', 'admin');
  const exam = await loadExam(db, examId);
  if (!exam || exam.a.userId !== actor.id) throw new CourseError('assessment_not_found');
  const [existing] = await db
    .select()
    .from(certificates)
    .where(eq(certificates.assessmentId, exam.a.id));
  if (existing) return certView(existing);
  if (exam.a.status !== 'passed') throw new CourseError('certificate_not_eligible');
  await holdCheck(db, exam.a.id);
  const key = opts.key === undefined ? activeSigningKey() : opts.key;
  if (!key) throw new CourseError('certificate_unavailable');

  const perSkill = (exam.a.perSkill ?? []) as ExamSkillResult[];
  const summary = await generateSummary(
    llm,
    { courseTitle: exam.title, skills: perSkill },
    exam.a.id,
  );

  const issued = await db.transaction(async (tx) => {
    // The same lock the exam and the strike decisions take, so a flag cannot slip in between the checks and the insert.
    const [a] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, exam.a.id))
      .for('update');
    const [again] = await tx
      .select()
      .from(certificates)
      .where(eq(certificates.assessmentId, exam.a.id));
    if (again) return again;
    if (a?.status !== 'passed') throw new CourseError('certificate_not_eligible');
    await holdCheck(tx, exam.a.id);
    await registerSigningKey(tx, key, opts.now);
    const id = randomUUID();
    const issuedAt = opts.now ?? new Date();
    const payload = buildPayload({
      certificateId: id,
      holderName: exam.holder,
      course: { id: exam.courseId, version: exam.versionNo, title: exam.title },
      rating: exam.rating,
      scorePct: a.scorePct ?? 0,
      issuedAt,
      perSkill,
      summary,
      kid: key.kid,
    });
    const [row] = await tx
      .insert(certificates)
      .values({
        id,
        userId: actor.id,
        courseVersionId: exam.a.courseVersionId,
        assessmentId: exam.a.id,
        payload,
        ...signPayload(payload, key),
        kid: key.kid,
        issuedAt,
      })
      .returning();
    await logEvent(
      tx,
      actor.id,
      'certificate_issued',
      { certificateId: id, assessmentId: exam.a.id },
      exam.a.courseVersionId,
    );
    return row!;
  });
  return certView(issued);
}

/** What the exam page needs: the certificate of this attempt, if there is one. */
export async function certificateOfExam(db: Db | Tx, examId: string) {
  const [row] = await db.select().from(certificates).where(eq(certificates.assessmentId, examId));
  return row ? certView(row) : null;
}

export async function listOwnCertificates(db: Db, user: AuthUser | null) {
  const actor = requireRole(user, 'student', 'author', 'expert', 'admin');
  const rows = await db
    .select()
    .from(certificates)
    .where(eq(certificates.userId, actor.id))
    .orderBy(desc(certificates.issuedAt));
  return rows.map(certView);
}

export interface PublicCertificate {
  id: string;
  payload: CertificatePayload;
  payloadSha256: string;
  signature: string;
  kid: string;
  /** The signature matches the stored payload, the stored hash and the certificate id (F10-R2). */
  signatureValid: boolean;
  status: 'valid' | 'revoked';
  revokedAt: Date | null;
}

/**
 * F10-R3: the public record. The signature is checked here against the key stored for `kid`, from the stored
 * payload, so a payload changed in the database is reported. `valid` needs a good signature and no revocation.
 * The reason of a revocation is for admins only. Returns null for an id that is not a certificate.
 */
export async function getPublicCertificate(db: Db, id: string): Promise<PublicCertificate | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db
    .select({ c: certificates, publicKey: signingKeys.publicKey })
    .from(certificates)
    .innerJoin(signingKeys, eq(signingKeys.kid, certificates.kid))
    .where(eq(certificates.id, id));
  if (!row) return null;
  const { c } = row;
  const input = signingInput(c.payload);
  const signatureValid =
    verifySignature(row.publicKey, input, c.signature) &&
    sha256Hex(input) === c.payloadSha256 &&
    c.payload.certificate_id === c.id &&
    c.payload.kid === c.kid;
  return {
    id: c.id,
    payload: c.payload,
    payloadSha256: c.payloadSha256,
    signature: c.signature,
    kid: c.kid,
    signatureValid,
    status: c.revokedAt ? 'revoked' : 'valid',
    revokedAt: c.revokedAt,
  };
}

/** F10-R2: the public keys as a JWK set, retired ones included (they still verify what they signed). */
export async function listPublicKeys(db: Db, active: SigningKey | null = activeSigningKey()) {
  if (active) await registerSigningKey(db, active);
  const rows = await db.select().from(signingKeys).orderBy(signingKeys.createdAt);
  return rows.map((k) => ({
    kty: 'OKP',
    crv: 'Ed25519',
    alg: 'EdDSA',
    use: 'sig',
    kid: k.kid,
    x: k.publicKey,
    ...(k.retiredAt ? { retired_at: k.retiredAt.toISOString() } : {}),
  }));
}

const revocation = z.object({ reason: z.string().trim().min(3).max(500) });

/** F10-R4: an admin revokes with a reason; the public page then shows the certificate as invalid. */
export async function revokeCertificate(
  db: Db,
  user: AuthUser | null,
  certificateId: string,
  body: unknown,
  now = new Date(),
) {
  const admin = requireRole(user, 'admin');
  const parsed = revocation.safeParse(body);
  if (!parsed.success) throw new CourseError('invalid_revocation');
  if (!UUID.test(certificateId)) throw new CourseError('certificate_not_found');
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(certificates)
      .where(eq(certificates.id, certificateId))
      .for('update');
    if (!c) throw new CourseError('certificate_not_found');
    if (c.revokedAt) throw new CourseError('invalid_certificate_state');
    await tx
      .update(certificates)
      .set({ revokedAt: now, revokeReason: parsed.data.reason })
      .where(eq(certificates.id, c.id));
    await logEvent(tx, c.userId, 'certificate_revoked', {
      certificateId: c.id,
      by: admin.id,
      auto: false,
    });
    return { id: c.id, revokedAt: now, reason: parsed.data.reason };
  });
}

/** A confirmed strike annuls a passed attempt (ADR-0013): its certificate goes with it. Called inside that transaction. */
export async function revokeCertificateOfAssessment(
  tx: Tx,
  assessmentId: string,
  reason: string,
  now: Date,
) {
  const [c] = await tx
    .update(certificates)
    .set({ revokedAt: now, revokeReason: reason })
    .where(and(eq(certificates.assessmentId, assessmentId), isNull(certificates.revokedAt)))
    .returning();
  if (c) {
    await logEvent(tx, c.userId, 'certificate_revoked', { certificateId: c.id, auto: true });
  }
}

/** Admin list (F11): every certificate with the holder and the revocation reason. */
export async function listCertificates(db: Db, user: AuthUser | null) {
  requireRole(user, 'admin');
  const rows = await db
    .select({ c: certificates, holderEmail: users.email })
    .from(certificates)
    .innerJoin(users, eq(users.id, certificates.userId))
    .orderBy(desc(certificates.issuedAt));
  return rows.map(({ c, holderEmail }) => ({
    id: c.id,
    holderName: c.payload.holder_name,
    holderEmail,
    title: c.payload.course.title,
    version: c.payload.course.version,
    scorePct: c.payload.score_pct,
    issuedAt: c.issuedAt,
    revokedAt: c.revokedAt,
    revokeReason: c.revokeReason,
  }));
}
