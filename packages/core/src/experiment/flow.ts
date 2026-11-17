/** Where a participant is inside one module: pre-test → learning → post-test → survey, then the delayed test. */
export type ModuleStep =
  | 'waiting'
  | 'pretest'
  | 'learning'
  | 'posttest'
  | 'survey'
  | 'delayed_wait'
  | 'delayed'
  | 'complete';

export interface ModuleFacts {
  /** The module of the earlier period is finished (its survey is in), or this is the first period. */
  previousDone: boolean;
  pretestDone: boolean;
  learningFinished: boolean;
  posttestSubmittedAt: Date | null;
  surveyDone: boolean;
  delayedDone: boolean;
}

/** The one step the participant is on. The server only lets them start what this says (P1). */
export function moduleStep(f: ModuleFacts, delaySeconds: number, now: Date): ModuleStep {
  if (!f.pretestDone) return f.previousDone ? 'pretest' : 'waiting';
  if (!f.learningFinished) return 'learning';
  if (!f.posttestSubmittedAt) return 'posttest';
  if (!f.surveyDone) return 'survey';
  if (f.delayedDone) return 'complete';
  const due = f.posttestSubmittedAt.getTime() + delaySeconds * 1000;
  return now.getTime() >= due ? 'delayed' : 'delayed_wait';
}

/** The next module may start once this one's survey is in; the delayed test comes later and does not block it. */
export const moduleDone = (f: Pick<ModuleFacts, 'surveyDone'>) => f.surveyDone;
