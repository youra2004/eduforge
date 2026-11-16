import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';

// A blank value (`FOO=` in .env) counts as unset, so it falls back to the default instead of 0.
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);
const seconds = (def: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().positive().default(def));
const fraction = (def: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().min(0).max(1).default(def));
const count = (def: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(def));

const optional = z.preprocess(blankToUndefined, z.string().min(1).optional());

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    TIME_SCALE: z.preprocess(blankToUndefined, z.coerce.number().positive().default(1)),

    NODE_PASS_THRESHOLD: fraction(0.8),
    BKT_P_INIT: fraction(0.2),
    BKT_LEARN: fraction(0.15),
    BKT_SLIP: fraction(0.1),
    NODE_ATTEMPTS_PER_ROUND: count(2),
    NODE_COOLDOWN_SECONDS: seconds(24 * 60 * 60),

    POOL_NODE_MIN_PER_SKILL: count(4),
    POOL_EXAM_MIN_PER_SKILL: count(3),
    OPEN_PASS_THRESHOLD: fraction(0.7),

    EXAM_PASS_PCT: fraction(0.7),
    EXAM_ATTEMPTS_PER_ROUND: count(2),
    EXAM_COOLDOWN_SECONDS: seconds(7 * 24 * 60 * 60),

    SNAPSHOT_INTERVAL_SECONDS: seconds(60),
    EVIDENCE_RETENTION_DAYS: seconds(30),

    SESSION_TTL_SECONDS: seconds(7 * 24 * 60 * 60),
    LOGIN_MAX_ATTEMPTS: count(5),
    LOGIN_WINDOW_SECONDS: seconds(15 * 60),
    TRUSTED_PROXY_HOPS: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).default(0)),

    EMBEDDING_DIM: count(1024),
    LLM_PROVIDER: z.enum(['mock']).default('mock'),
    EMBEDDING_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
    EMBEDDING_MODEL: z.preprocess(blankToUndefined, z.string().default('text-embedding-3-large')),
    TRANSCRIPTION_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
    WHISPER_MODEL: z.preprocess(blankToUndefined, z.string().default('whisper-1')),
    OPENAI_API_KEY: optional,
    // Where uploaded videos live. The web app and the worker must see the same directory.
    STORAGE_DIR: z.preprocess(
      blankToUndefined,
      z
        .string()
        .refine(isAbsolute, 'must be an absolute path')
        .default(join(homedir(), '.eduforge', 'storage')),
    ),
  })
  .refine(
    (e) =>
      !(e.EMBEDDING_PROVIDER === 'openai' || e.TRANSCRIPTION_PROVIDER === 'openai') ||
      e.OPENAI_API_KEY,
    { path: ['OPENAI_API_KEY'], message: 'required when a provider is set to openai' },
  );

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
    questions: {
      nodeMinPerSkill: env.POOL_NODE_MIN_PER_SKILL,
      examMinPerSkill: env.POOL_EXAM_MIN_PER_SKILL,
      openPassThreshold: env.OPEN_PASS_THRESHOLD,
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
    auth: {
      sessionTtlSeconds: env.SESSION_TTL_SECONDS,
      loginMaxAttempts: env.LOGIN_MAX_ATTEMPTS,
      loginWindowSeconds: env.LOGIN_WINDOW_SECONDS,
      trustedProxyHops: env.TRUSTED_PROXY_HOPS,
    },
    embeddingDim: env.EMBEDDING_DIM,
    llmProvider: env.LLM_PROVIDER,
    embedding: { provider: env.EMBEDDING_PROVIDER, model: env.EMBEDDING_MODEL },
    transcription: { provider: env.TRANSCRIPTION_PROVIDER, model: env.WHISPER_MODEL },
    openaiApiKey: env.OPENAI_API_KEY,
    storageDir: env.STORAGE_DIR,
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
