import { consents, type ConsentKind, type Db } from '@eduforge/db';
import { desc, eq } from 'drizzle-orm';

/** Current version of each consent text. Bump a value when the text changes; users must accept again. */
export const CONSENT_VERSIONS: Record<ConsentKind, string> = {
  terms: '2026-11-16',
  research: '2026-11-16',
  proctoring: '2026-11-16',
};

/** Records that the user accepted the current version of `kind` now. Rows are append-only. */
export async function recordConsent(db: Db, userId: string, kind: ConsentKind) {
  const [row] = await db
    .insert(consents)
    .values({ userId, kind, version: CONSENT_VERSIONS[kind] })
    .returning();
  return row!;
}

/** The latest consent the user gave for each kind. */
export async function latestConsents(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(consents)
    .where(eq(consents.userId, userId))
    .orderBy(desc(consents.givenAt));
  const latest = new Map<ConsentKind, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.kind)) latest.set(row.kind, row);
  return latest;
}

/** True if the user has accepted the current version of `kind`. */
export async function hasCurrentConsent(db: Db, userId: string, kind: ConsentKind) {
  const latest = await latestConsents(db, userId);
  return latest.get(kind)?.version === CONSENT_VERSIONS[kind];
}
