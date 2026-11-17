import {
  contentItems,
  courseVersions,
  nodes,
  nodeSkills,
  questions,
  skills,
  type Db,
} from '@eduforge/db';
import { and, asc, eq } from 'drizzle-orm';

export interface AuditMaterial {
  declaration: { title: string; description: string; declaredLevel: string | null };
  skills: { id: string; name: string; description: string; material: string }[];
  nodes: { id: string; title: string; summary: string; text: string }[];
  metrics: {
    nodes: number;
    skills: number;
    charsPerNode: number;
    codeBlocksPerNode: number;
    questions: { total: number; avgDifficulty: number; openShare: number };
  };
}

/** Per node cap on the text sent to the auditor, so a large course stays within the model's window. */
const NODE_EXCERPT = 3000;
const SKILL_EXCERPT = 4000;
export const excerpt = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)} …` : text;

/** Everything the auditor reads: the declaration, each node's text (markdown and transcripts), what teaches each skill, and size metrics. */
export async function loadAuditMaterial(db: Db, versionId: string): Promise<AuditMaterial> {
  const [version] = await db.select().from(courseVersions).where(eq(courseVersions.id, versionId));
  if (!version) throw new Error(`No version ${versionId}`);
  const [skillRows, nodeRows, links, items, qs] = await Promise.all([
    db.select().from(skills).where(eq(skills.courseVersionId, versionId)).orderBy(asc(skills.name)),
    db.select().from(nodes).where(eq(nodes.courseVersionId, versionId)).orderBy(asc(nodes.title)),
    db
      .select({ nodeId: nodeSkills.nodeId, skillId: nodeSkills.skillId })
      .from(nodeSkills)
      .innerJoin(nodes, eq(nodes.id, nodeSkills.nodeId))
      .where(eq(nodes.courseVersionId, versionId)),
    db
      .select({
        nodeId: contentItems.nodeId,
        kind: contentItems.kind,
        body: contentItems.bodyMd,
        transcript: contentItems.transcriptText,
      })
      .from(contentItems)
      .innerJoin(nodes, eq(nodes.id, contentItems.nodeId))
      .where(eq(nodes.courseVersionId, versionId))
      .orderBy(asc(contentItems.ord), asc(contentItems.id)),
    db
      .select({ kind: questions.kind, difficulty: questions.difficulty })
      .from(questions)
      .innerJoin(nodes, eq(nodes.id, questions.nodeId))
      .where(and(eq(nodes.courseVersionId, versionId), eq(questions.status, 'validated'))),
  ]);

  const textOf = (nodeId: string) =>
    items
      .filter((i) => i.nodeId === nodeId)
      .map((i) => (i.kind === 'markdown' ? i.body : i.transcript) ?? '')
      .filter((t) => t.trim() !== '')
      .join('\n\n');
  const nodeTexts = new Map(nodeRows.map((n) => [n.id, textOf(n.id)]));
  const totalChars = [...nodeTexts.values()].reduce((sum, t) => sum + t.length, 0);
  const codeBlocks = [...nodeTexts.values()].reduce(
    (sum, t) => sum + Math.floor((t.match(/```/g)?.length ?? 0) / 2),
    0,
  );
  const per = Math.max(1, nodeRows.length);

  return {
    declaration: {
      title: version.title,
      description: version.description,
      declaredLevel: version.declaredLevel,
    },
    skills: skillRows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      material: excerpt(
        links
          .filter((l) => l.skillId === s.id)
          .map((l) => nodeTexts.get(l.nodeId) ?? '')
          .join('\n\n'),
        SKILL_EXCERPT,
      ),
    })),
    nodes: nodeRows.map((n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary,
      text: excerpt(nodeTexts.get(n.id) ?? '', NODE_EXCERPT),
    })),
    metrics: {
      nodes: nodeRows.length,
      skills: skillRows.length,
      charsPerNode: Math.round(totalChars / per),
      codeBlocksPerNode: Math.round((codeBlocks / per) * 100) / 100,
      questions: {
        total: qs.length,
        avgDifficulty:
          qs.length === 0
            ? 0
            : Math.round((qs.reduce((s, q) => s + q.difficulty, 0) / qs.length) * 100) / 100,
        openShare:
          qs.length === 0
            ? 0
            : Math.round((qs.filter((q) => q.kind === 'open').length / qs.length) * 100) / 100,
      },
    },
  };
}
