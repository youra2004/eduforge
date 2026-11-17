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

/** `"6:3,12:6,20:9"`: below 6 nodes the cap is 3, below 12 it is 6, below 20 it is 9, from 20 on it is 10 (F4-R1). */
const volumeCaps = z
  .preprocess(blankToUndefined, z.string().default('6:3,12:6,20:9'))
  .transform((raw, ctx) => {
    const steps = raw.split(',').map((part) => {
      const [below, cap] = part.split(':').map((n) => Number(n.trim()));
      return { below: below!, cap: cap! };
    });
    const ok = steps.every(
      (s, i) =>
        Number.isInteger(s.below) &&
        s.below > 0 &&
        Number.isInteger(s.cap) &&
        s.cap >= 1 &&
        s.cap <= 9 &&
        (i === 0 || (s.below > steps[i - 1]!.below && s.cap > steps[i - 1]!.cap)),
    );
    if (!ok) {
      ctx.addIssue({
        code: 'custom',
        message: 'expected ascending "nodes:cap" pairs such as 6:3,12:6,20:9 (caps 1-9)',
      });
      return z.NEVER;
    }
    return steps;
  });

/** `"3:20:45,6:30:60,10:40:90"`: ratings up to 3 get 20 questions in 45 minutes, up to 6 get 30 in 60, up to 10 get 40 in 90 (F8-R2). */
const examProfiles = z
  .preprocess(blankToUndefined, z.string().default('3:20:45,6:30:60,10:40:90'))
  .transform((raw, ctx) => {
    const steps = raw.split(',').map((part) => {
      const [maxRating, questions, minutes] = part.split(':').map((n) => Number(n.trim()));
      return { maxRating: maxRating!, questions: questions!, minutes: minutes! };
    });
    const ok =
      steps.length > 0 &&
      steps.every(
        (s, i) =>
          Number.isInteger(s.maxRating) &&
          s.maxRating >= 1 &&
          Number.isInteger(s.questions) &&
          s.questions >= 1 &&
          s.minutes > 0 &&
          (i === 0 || s.maxRating > steps[i - 1]!.maxRating),
      ) &&
      steps[steps.length - 1]!.maxRating === 10;
    if (!ok) {
      ctx.addIssue({
        code: 'custom',
        message:
          'expected ascending "maxRating:questions:minutes" triples ending at rating 10, such as 3:20:45,6:30:60,10:40:90',
      });
      return z.NEVER;
    }
    return steps;
  });

const optional = z.preprocess(blankToUndefined, z.string().min(1).optional());

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    TIME_SCALE: z.preprocess(blankToUndefined, z.coerce.number().positive().default(1)),

    NODE_PASS_THRESHOLD: fraction(0.8),
    BKT_P_INIT: fraction(0.2),
    BKT_LEARN: fraction(0.15),
    BKT_SLIP: fraction(0.1),
    NODE_TEST_QUESTIONS_PER_SKILL: count(3),
    NODE_ATTEMPTS_PER_ROUND: count(2),
    NODE_COOLDOWN_SECONDS: seconds(24 * 60 * 60),

    TUTOR_RATE_PER_MINUTE: count(6),
    TUTOR_DAILY_TOKEN_BUDGET: count(60000),

    EXPERIMENT_COURSE_A: z.preprocess(blankToUndefined, z.string().min(1).default('experiment-a')),
    EXPERIMENT_COURSE_B: z.preprocess(blankToUndefined, z.string().min(1).default('experiment-b')),
    EXPERIMENT_DELAY_SECONDS: seconds(7 * 24 * 60 * 60),
    EXPERIMENT_HEARTBEAT_SECONDS: seconds(30),

    POOL_NODE_MIN_PER_SKILL: count(4),
    POOL_EXAM_MIN_PER_SKILL: count(3),
    OPEN_PASS_THRESHOLD: fraction(0.7),

    EXAM_PASS_PCT: fraction(0.7),
    EXAM_ATTEMPTS_PER_ROUND: count(2),
    EXAM_COOLDOWN_SECONDS: seconds(7 * 24 * 60 * 60),
    EXAM_PROFILES: examProfiles,
    EXAM_CHOICE_QUESTION_SECONDS: seconds(90),
    EXAM_OPEN_QUESTION_SECONDS: seconds(5 * 60),
    EXAM_MAX_INTERRUPTIONS: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(0).default(2),
    ),
    EXAM_PERFECT_PCT: fraction(0.9),

    SNAPSHOT_INTERVAL_SECONDS: seconds(60),
    EVIDENCE_RETENTION_DAYS: seconds(30),

    AUDIT_MAX_ATTEMPTS: count(5),
    AUDIT_SCORING_RUNS: count(5),
    AUDIT_VOLUME_CAPS: volumeCaps,

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
      questionsPerSkill: env.NODE_TEST_QUESTIONS_PER_SKILL,
      attemptsPerRound: env.NODE_ATTEMPTS_PER_ROUND,
      cooldownSeconds: env.NODE_COOLDOWN_SECONDS,
    },
    tutor: {
      ratePerMinute: env.TUTOR_RATE_PER_MINUTE,
      dailyTokenBudget: env.TUTOR_DAILY_TOKEN_BUDGET,
    },
    experiment: {
      // The courses (by slug) that are topic A and topic B of the study (D-30).
      courseSlugs: { A: env.EXPERIMENT_COURSE_A, B: env.EXPERIMENT_COURSE_B },
      delaySeconds: env.EXPERIMENT_DELAY_SECONDS,
      heartbeatSeconds: env.EXPERIMENT_HEARTBEAT_SECONDS,
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
      profiles: env.EXAM_PROFILES,
      choiceQuestionSeconds: env.EXAM_CHOICE_QUESTION_SECONDS,
      openQuestionSeconds: env.EXAM_OPEN_QUESTION_SECONDS,
      maxInterruptions: env.EXAM_MAX_INTERRUPTIONS,
      perfectPct: env.EXAM_PERFECT_PCT,
    },
    proctoring: {
      snapshotIntervalSeconds: env.SNAPSHOT_INTERVAL_SECONDS,
      evidenceRetentionDays: env.EVIDENCE_RETENTION_DAYS,
    },
    audit: {
      maxAttempts: env.AUDIT_MAX_ATTEMPTS,
      scoringRuns: env.AUDIT_SCORING_RUNS,
      volumeCaps: env.AUDIT_VOLUME_CAPS,
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
