import { nodes, nodeSkills, questions, skills, type Db } from '@eduforge/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { CourseIssue } from '../courses/graph';

export interface PoolMinimums {
  nodeMinPerSkill: number;
  examMinPerSkill: number;
}

/**
 * F3-R6: every skill of every node needs `nodeMinPerSkill` validated questions in that node's `node` pool, and every
 * skill of the course `examMinPerSkill` validated questions in the `exam` pool. Reports each shortfall with the exact
 * numbers, so the author knows which questions are missing. Part of the publication checks (F1-R3).
 */
export async function poolIssues(
  db: Db,
  versionId: string,
  mins: PoolMinimums,
): Promise<CourseIssue[]> {
  const [nodeSkillRows, skillRows, counts] = await Promise.all([
    db
      .select({
        nodeId: nodes.id,
        nodeTitle: nodes.title,
        skillId: skills.id,
        skillName: skills.name,
      })
      .from(nodes)
      .innerJoin(nodeSkills, eq(nodeSkills.nodeId, nodes.id))
      .innerJoin(skills, eq(skills.id, nodeSkills.skillId))
      .where(eq(nodes.courseVersionId, versionId))
      .orderBy(asc(nodes.title), asc(skills.name)),
    db
      .select({ id: skills.id, name: skills.name })
      .from(skills)
      .where(eq(skills.courseVersionId, versionId))
      .orderBy(asc(skills.name)),
    db
      .select({
        nodeId: questions.nodeId,
        skillId: questions.skillId,
        pool: questions.pool,
        n: sql<number>`count(*)::int`,
      })
      .from(questions)
      .innerJoin(nodes, eq(nodes.id, questions.nodeId))
      .where(and(eq(nodes.courseVersionId, versionId), eq(questions.status, 'validated')))
      .groupBy(questions.nodeId, questions.skillId, questions.pool),
  ]);

  const issues: CourseIssue[] = [];
  const nodeHave = (nodeId: string, skillId: string) =>
    counts.find((c) => c.pool === 'node' && c.nodeId === nodeId && c.skillId === skillId)?.n ?? 0;
  for (const r of nodeSkillRows) {
    const have = nodeHave(r.nodeId, r.skillId);
    if (have < mins.nodeMinPerSkill) {
      issues.push({
        code: 'pool_too_small',
        message: `Node "${r.nodeTitle}", skill "${r.skillName}": ${have} of ${mins.nodeMinPerSkill} validated questions in the node pool (${mins.nodeMinPerSkill - have} missing).`,
        nodeIds: [r.nodeId],
        skillId: r.skillId,
        pool: 'node',
        have,
        need: mins.nodeMinPerSkill,
      });
    }
  }
  for (const s of skillRows) {
    const have = counts
      .filter((c) => c.pool === 'exam' && c.skillId === s.id)
      .reduce((sum, c) => sum + c.n, 0);
    if (have < mins.examMinPerSkill) {
      issues.push({
        code: 'pool_too_small',
        message: `Skill "${s.name}": ${have} of ${mins.examMinPerSkill} validated questions in the exam pool (${mins.examMinPerSkill - have} missing).`,
        skillId: s.id,
        pool: 'exam',
        have,
        need: mins.examMinPerSkill,
      });
    }
  }
  return issues;
}
