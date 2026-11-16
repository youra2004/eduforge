import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCourseImport } from './import';

const demo = JSON.parse(
  readFileSync(new URL('../../seed/demo-course.json', import.meta.url), 'utf8'),
);

const base = () => ({
  slug: 'tiny',
  title: 'Tiny',
  skills: [{ key: 's', name: 'Skill' }],
  nodes: [
    { key: 'a', title: 'A', skills: ['s'] },
    { key: 'b', title: 'B', skills: ['s'] },
  ],
  edges: [{ from: 'a', to: 'b' }],
});

const codes = (input: unknown) => {
  const res = parseCourseImport(input);
  return res.ok ? [] : res.issues.map((i) => i.code);
};

describe('parseCourseImport', () => {
  it('accepts the seed course: 8 nodes, 2-3 skills each, no validation issues', () => {
    const res = parseCourseImport(demo);
    expect(res.ok).toBe(true);
    expect(demo.nodes).toHaveLength(8);
    for (const n of demo.nodes) expect(n.skills.length).toBeGreaterThanOrEqual(2);
    for (const n of demo.nodes) expect(n.skills.length).toBeLessThanOrEqual(3);
  });

  it('reports schema problems with their paths', () => {
    const res = parseCourseImport({ ...base(), slug: 'Bad Slug', nodes: 'nope' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.path).sort()).toEqual(['nodes', 'slug']);
  });

  it('reports unknown references, duplicates and self loops together', () => {
    const input = base();
    input.nodes[0]!.skills = ['s', 'missing'];
    input.nodes.push({ key: 'a', title: 'dup', skills: ['s'] });
    input.edges.push({ from: 'a', to: 'ghost' }, { from: 'b', to: 'b' }, { from: 'a', to: 'b' });
    expect(codes(input)).toEqual(
      expect.arrayContaining(['unknown_reference', 'duplicate_key', 'self_loop', 'duplicate_edge']),
    );
  });

  it('includes the graph validation errors', () => {
    const input = base();
    input.edges.push({ from: 'b', to: 'a' });
    expect(codes(input)).toEqual(expect.arrayContaining(['cycle', 'no_root']));
  });
});
