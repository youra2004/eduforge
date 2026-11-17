import { z } from 'zod';
import { auditLevels } from './rating';

const note = z.string().max(2000);

/** Stage 1 (F4-R2): does the content match the declared description and level? */
export const conformitySchema = z.object({
  matches: z.boolean(),
  mismatches: z.array(z.string().max(500)).max(20),
  feedback: note,
});

/** Stage 2 (F4-R3): is each declared skill covered by the content? */
export const skillsSchema = z.object({
  skills: z.array(z.object({ skillId: z.string(), covered: z.boolean(), note })).max(500),
});

/** Stage 3 (F4-R4): the two axes plus feedback per category (F4-R7). */
export const scoringSchema = z.object({
  level: z.enum(auditLevels),
  hardness: z.number().min(0).max(1),
  feedback: z.object({ theoryDepth: note, questionTrickiness: note, edgeCases: note }),
});

export type Conformity = z.infer<typeof conformitySchema>;
export type SkillsVerdict = z.infer<typeof skillsSchema>;
export type Scoring = z.infer<typeof scoringSchema>;
