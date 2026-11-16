import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDb, users } from '@eduforge/db';
import { eq } from 'drizzle-orm';
import { CourseError, importCourse } from '../src/courses';
import { loadConfig } from '../src/config';

// Usage: pnpm import-course <course.json> <author email>
const [file, email] = process.argv.slice(2);
if (!file || !email) {
  console.error('Usage: pnpm import-course <course.json> <author email>');
  process.exit(1);
}

const { db, pool } = createDb(loadConfig().databaseUrl);
try {
  const [author] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()));
  if (!author) throw new Error(`No user with email ${email}`);
  const { versionId } = await importCourse(
    db,
    JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? '.', file), 'utf8')),
    author.id,
  );
  console.log(`Imported ${file} as draft version ${versionId}`);
} catch (err) {
  if (err instanceof CourseError) {
    console.error(`Import failed (${err.code}):`);
    for (const issue of err.issues) {
      console.error(`  - [${issue.code}] ${issue.path ? `${issue.path}: ` : ''}${issue.message}`);
    }
  } else {
    console.error(err instanceof Error ? `Failed: ${err.message}` : err);
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
