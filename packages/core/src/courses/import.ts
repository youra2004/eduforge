import { z } from 'zod';
import { validateGraph, type CourseIssue } from './graph';

export const declaredLevels = ['junior', 'middle', 'senior', 'expert'] as const;

const key = z.string().trim().min(1).max(64);

/** The course JSON format (F1-R6). Skills, nodes and edges refer to each other by the local `key`s. */
export const courseImportSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits and single dashes'),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(''),
  declaredLevel: z.enum(declaredLevels).optional(),
  skills: z
    .array(
      z.object({
        key,
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).default(''),
      }),
    )
    .max(200),
  nodes: z
    .array(
      z.object({
        key,
        title: z.string().trim().min(1).max(200),
        summary: z.string().trim().max(2000).default(''),
        skills: z.array(key).max(50),
        position: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
      }),
    )
    .max(500),
  /** `from` is the prerequisite, `to` the node it unlocks. */
  edges: z.array(z.object({ from: key, to: key })).max(5000),
});

export type CourseImport = z.output<typeof courseImportSchema>;

const dupes = (keys: string[]) => [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];

/** Parses and checks an import. Returns all problems as a list; nothing is written here. */
export function parseCourseImport(
  input: unknown,
): { ok: true; data: CourseImport } | { ok: false; issues: CourseIssue[] } {
  const parsed = courseImportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: 'schema' as const,
        message: i.message,
        path: i.path.join('.'),
      })),
    };
  }
  const data = parsed.data;
  const issues: CourseIssue[] = [];

  for (const k of dupes(data.skills.map((s) => s.key))) {
    issues.push({ code: 'duplicate_key', message: `Duplicate skill key: ${k}.`, path: 'skills' });
  }
  for (const k of dupes(data.nodes.map((n) => n.key))) {
    issues.push({
      code: 'duplicate_key',
      message: `Duplicate node key: ${k}.`,
      path: 'nodes',
      nodeIds: [k],
    });
  }

  const skillKeys = new Set(data.skills.map((s) => s.key));
  const nodeKeys = new Set(data.nodes.map((n) => n.key));
  data.nodes.forEach((n, i) => {
    for (const s of n.skills.filter((s) => !skillKeys.has(s))) {
      issues.push({
        code: 'unknown_reference',
        message: `Node ${n.key} uses unknown skill ${s}.`,
        path: `nodes.${i}.skills`,
        nodeIds: [n.key],
      });
    }
  });

  const seenEdges = new Set<string>();
  data.edges.forEach((e, i) => {
    const path = `edges.${i}`;
    const unknown = [e.from, e.to].filter((k) => !nodeKeys.has(k));
    if (unknown.length > 0) {
      issues.push({
        code: 'unknown_reference',
        message: `Edge uses unknown node ${unknown.join(', ')}.`,
        path,
      });
    } else if (e.from === e.to) {
      issues.push({
        code: 'self_loop',
        message: `Node ${e.from} lists itself as a prerequisite.`,
        path,
        nodeIds: [e.from],
      });
    } else if (seenEdges.has(`${e.from}\0${e.to}`)) {
      issues.push({
        code: 'duplicate_edge',
        message: `Duplicate edge ${e.from} -> ${e.to}.`,
        path,
      });
    }
    seenEdges.add(`${e.from}\0${e.to}`);
  });

  issues.push(
    ...validateGraph({
      nodes: data.nodes.map((n) => ({
        id: n.key,
        skillIds: n.skills.filter((s) => skillKeys.has(s)),
      })),
      edges: data.edges,
    }),
  );

  return issues.length > 0 ? { ok: false, issues } : { ok: true, data };
}
