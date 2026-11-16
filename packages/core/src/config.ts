import { z } from 'zod';

const num = (def: number) => z.coerce.number().default(def);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TIME_SCALE: z.coerce.number().positive().default(1),

  NODE_PASS_THRESHOLD: num(0.8),
  BKT_P_INIT: num(0.2),
  BKT_LEARN: num(0.15),
  BKT_SLIP: num(0.1),
  NODE_ATTEMPTS_PER_ROUND: z.coerce.number().int().positive().default(2),
  NODE_COOLDOWN_SECONDS: num(24 * 60 * 60),

  EXAM_PASS_PCT: num(0.7),
  EXAM_ATTEMPTS_PER_ROUND: z.coerce.number().int().positive().default(2),
  EXAM_COOLDOWN_SECONDS: num(7 * 24 * 60 * 60),

  SNAPSHOT_INTERVAL_SECONDS: num(60),
  EVIDENCE_RETENTION_DAYS: num(30),

  EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),
  LLM_PROVIDER: z.enum(['mock']).default('mock'),
});

export type Config = ReturnType<typeof toConfig>;

function toConfig(env: z.infer<typeof envSchema>) {
  return {
    databaseUrl: env.DATABASE_URL,
    timeScale: env.TIME_SCALE,
    node: {
      passThreshold: env.NODE_PASS_THRESHOLD,
      attemptsPerRound: env.NODE_ATTEMPTS_PER_ROUND,
      cooldownSeconds: env.NODE_COOLDOWN_SECONDS,
    },
    bkt: { pInit: env.BKT_P_INIT, learn: env.BKT_LEARN, slip: env.BKT_SLIP },
    exam: {
      passPct: env.EXAM_PASS_PCT,
      attemptsPerRound: env.EXAM_ATTEMPTS_PER_ROUND,
      cooldownSeconds: env.EXAM_COOLDOWN_SECONDS,
    },
    proctoring: {
      snapshotIntervalSeconds: env.SNAPSHOT_INTERVAL_SECONDS,
      evidenceRetentionDays: env.EVIDENCE_RETENTION_DAYS,
    },
    embeddingDim: env.EMBEDDING_DIM,
    llmProvider: env.LLM_PROVIDER,
  };
}

/** Parses and validates env; throws a readable error listing every bad variable. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return toConfig(parsed.data);
}
