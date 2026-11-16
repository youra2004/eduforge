import type { PgBoss } from 'pg-boss';
import {
  findPendingQuestionIds,
  generateQuestions,
  GENERATE_QUESTIONS_QUEUE,
  validateQuestion,
  VALIDATE_QUESTION_QUEUE,
  type GenerateQuestionsJob,
  type ValidateQuestionJob,
} from '@eduforge/core';
import type { Db } from '@eduforge/db';
import type { LLMClient } from '@eduforge/llm';

export interface QuestionJobDeps {
  db: Db;
  llm: LLMClient;
  slip: number;
}

// `short`: at most one waiting job per key; an LLM failure is retried a few times, then left for the next start.
const queueOptions = { policy: 'short', retryLimit: 3, retryDelay: 10 } as const;

export const enqueueValidate = (boss: PgBoss, questionId: string) =>
  boss.send(VALIDATE_QUESTION_QUEUE, { questionId } satisfies ValidateQuestionJob, {
    singletonKey: questionId,
  });

/** Queues a validation for every question still waiting for one (for example after the worker was down). */
export async function requeuePending(boss: PgBoss, { db }: Pick<QuestionJobDeps, 'db'>) {
  const ids = await findPendingQuestionIds(db);
  await Promise.all(ids.map((id) => enqueueValidate(boss, id)));
  return ids.length;
}

export async function registerQuestionJobs(boss: PgBoss, deps: QuestionJobDeps) {
  await boss.createQueue(GENERATE_QUESTIONS_QUEUE, queueOptions);
  await boss.createQueue(VALIDATE_QUESTION_QUEUE, queueOptions);

  await boss.work<GenerateQuestionsJob>(
    GENERATE_QUESTIONS_QUEUE,
    { pollingIntervalSeconds: 1 },
    async ([job]) => {
      if (!job) return;
      const r = await generateQuestions(deps.db, deps.llm, { slip: deps.slip }, job.data);
      console.log(`[questions.generate] ${job.data.nodeId}/${job.data.pool}`, {
        created: r.questionIds.length,
        dropped: r.dropped,
      });
      await Promise.all(r.questionIds.map((id) => enqueueValidate(boss, id)));
    },
  );

  await boss.work<ValidateQuestionJob>(
    VALIDATE_QUESTION_QUEUE,
    { pollingIntervalSeconds: 1, localConcurrency: 4 },
    async ([job]) => {
      if (!job) return;
      const r = await validateQuestion(deps.db, deps.llm, job.data.questionId);
      console.log(`[questions.validate] ${job.data.questionId}`, r.status);
    },
  );

  const pending = await requeuePending(boss, deps);
  if (pending > 0) console.log(`[questions] re-queued ${pending} pending validations`);
}
