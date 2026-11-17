import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assessments,
  courseVersions,
  courses,
  createDb,
  proctorEvents,
  proctorEvidence,
  users,
} from '@eduforge/db';
import { eq } from 'drizzle-orm';
import { EVIDENCE_RETENTION_QUEUE, registerProctorJobs } from './proctorJobs';

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url);
const boss = new PgBoss(url);
let storageDir: string;

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'eduforge-retention-'));
  await boss.start();
});
afterAll(async () => {
  await boss.stop();
  await pool.end();
});

describe('evidence retention job (F9-R7)', () => {
  it('on its queue, deletes expired evidence with its file and keeps what has not expired', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `retention-${Date.now()}@test.local`, passwordHash: 'x', displayName: 'Т' })
      .returning();
    const [course] = await db
      .insert(courses)
      .values({ slug: `ret-${Date.now()}`, authorId: user!.id })
      .returning();
    const [version] = await db
      .insert(courseVersions)
      .values({ courseId: course!.id, versionNo: 1, title: 'Т', status: 'published' })
      .returning();
    const [a] = await db
      .insert(assessments)
      .values({ userId: user!.id, kind: 'exam', courseVersionId: version!.id, questionSetSeed: 1 })
      .returning();
    await mkdir(join(storageDir, 'evidence'), { recursive: true });
    const make = async (expiresAt: Date) => {
      const [ev] = await db
        .insert(proctorEvents)
        .values({ assessmentId: a!.id, source: 'frame', type: 'phone', severity: 'soft' })
        .returning();
      const storageKey = `${randomUUID()}.enc`;
      await writeFile(join(storageDir, 'evidence', storageKey), 'x');
      await db
        .insert(proctorEvidence)
        .values({ eventId: ev!.id, storageKey, sha256: 'x', expiresAt });
      return storageKey;
    };
    const old = await make(new Date(Date.now() - 1000));
    const fresh = await make(new Date(Date.now() + 86_400_000));

    await registerProctorJobs(boss, { db, storageDir });
    const end = Date.now() + 20_000;
    while (existsSync(join(storageDir, 'evidence', old)) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(existsSync(join(storageDir, 'evidence', old))).toBe(false);
    expect(existsSync(join(storageDir, 'evidence', fresh))).toBe(true);
    const left = await db
      .select()
      .from(proctorEvidence)
      .where(eq(proctorEvidence.storageKey, fresh));
    expect(left).toHaveLength(1);
    expect(EVIDENCE_RETENTION_QUEUE).toBe('proctor.retention');
  });
});
