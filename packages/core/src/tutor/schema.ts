import { z } from 'zod';

/** P3: the tutor and the guard answer in a fixed shape. */
export const tutorOutput = z.object({ hint: z.string().trim().min(1).max(1500) });
export const guardOutput = z.object({ revealed: z.boolean(), reason: z.string().max(500) });

export const tutorInput = z.object({
  message: z.string().trim().min(1).max(1000),
  /** Continue a conversation; it must be the caller's and about the same node and question. */
  sessionId: z.uuid().optional(),
  /** A practice question the student is stuck on (node pool only). */
  questionId: z.uuid().optional(),
  /** The student's own answer, for a question they have not answered in a test (practice). */
  studentAnswer: z.string().trim().max(2000).optional(),
});
export type TutorInput = z.input<typeof tutorInput>;
