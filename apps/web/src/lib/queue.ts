import { PgBoss } from 'pg-boss';
import {
  AUDIT_QUEUE,
  GENERATE_QUESTIONS_QUEUE,
  INDEX_NODE_QUEUE,
  loadConfig,
  needsTranscription,
  TRANSCRIBE_QUEUE,
  VALIDATE_QUESTION_QUEUE,
  type AuditJob,
  type GenerateQuestionsJob,
  type IndexNodeJob,
  type TranscribeJob,
  type ValidateQuestionJob,
} from '@eduforge/core';
import type { ContentItem } from '@eduforge/db';

const globalForBoss = globalThis as unknown as { eduforgeBoss?: Promise<PgBoss> };

/** A send-only pg-boss: the worker owns the schema, the queues and the job handlers. */
function getBoss() {
  globalForBoss.eduforgeBoss ??= (async () => {
    const boss = new PgBoss({
      connectionString: loadConfig().databaseUrl,
      migrate: false,
      supervise: false,
      schedule: false,
    });
    boss.on('error', (err) => console.error('[web] pg-boss error', err));
    try {
      await boss.start();
    } catch (err) {
      globalForBoss.eduforgeBoss = undefined; // try again on the next request
      throw err;
    }
    return boss;
  })();
  return globalForBoss.eduforgeBoss;
}

/**
 * Asks the worker to index the item's node and, for an uploaded video without a transcript, to
 * transcribe it. Saving content must not fail because the queue is down, so errors are only logged:
 * the worker's sweep queues whatever was missed once it is running.
 */
export async function queueContentWork(
  item: Pick<ContentItem, 'id' | 'nodeId' | 'kind' | 'videoStorageKey' | 'transcriptText'>,
) {
  try {
    const boss = await getBoss();
    await boss.send(INDEX_NODE_QUEUE, { nodeId: item.nodeId } satisfies IndexNodeJob, {
      singletonKey: item.nodeId,
    });
    if (needsTranscription(item)) {
      await boss.send(TRANSCRIBE_QUEUE, { contentItemId: item.id } satisfies TranscribeJob, {
        singletonKey: item.id,
      });
    }
  } catch (err) {
    console.error('[web] could not queue content work; the worker will pick it up later', err);
  }
}

/** Asks the worker to generate questions for a node. Unlike content work this is an explicit request, so a down queue is an error. */
export async function queueGenerateQuestions(job: GenerateQuestionsJob) {
  const boss = await getBoss();
  const id = await boss.send(GENERATE_QUESTIONS_QUEUE, job, {
    singletonKey: `${job.nodeId}:${job.pool}`,
  });
  return { alreadyQueued: id === null }; // a request for the same node and pool is still waiting
}

/** Asks the worker to validate one question; if the queue is down the worker re-queues pending ones when it starts. */
export async function queueValidateQuestion(questionId: string) {
  try {
    const boss = await getBoss();
    await boss.send(VALIDATE_QUESTION_QUEUE, { questionId } satisfies ValidateQuestionJob, {
      singletonKey: questionId,
    });
  } catch (err) {
    console.error('[web] could not queue validation; the worker will pick it up later', err);
  }
}

/** Asks the worker to run an audit. The version is already `auditing`; if the queue is down the worker picks it up when it starts. */
export async function queueAudit(job: AuditJob) {
  try {
    const boss = await getBoss();
    await boss.send(AUDIT_QUEUE, job, { singletonKey: `${job.versionId}:${job.attemptNo}` });
  } catch (err) {
    console.error(
      '[web] could not queue the audit; the worker will pick it up when it starts',
      err,
    );
  }
}
