import type { QuestionPool } from '@eduforge/db';

/** Queue names and payloads shared by the web app (which sends jobs) and the worker (which runs them). */
export const GENERATE_QUESTIONS_QUEUE = 'questions.generate';
export const VALIDATE_QUESTION_QUEUE = 'questions.validate';

export interface GenerateQuestionsJob {
  nodeId: string;
  pool: QuestionPool;
  perSkill: number;
}

export interface ValidateQuestionJob {
  questionId: string;
}
