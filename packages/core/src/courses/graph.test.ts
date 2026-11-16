import { describe, expect, it } from 'vitest';
import { nodeLayers, placeholderNodeStates, validateGraph, type GraphInput } from './graph';

// Compact builder: 'a:s1,s2' is node a with two skills; 'a>b' is an edge, a is b's prerequisite.
function g(nodes: string[], edges: string[] = []): GraphInput {
  return {
    nodes: nodes.map((n) => {
      const [id, skills = ''] = n.split(':');
      return { id: id!, skillIds: skills ? skills.split(',') : [] };
    }),
    edges: edges.map((e) => {
      const [from, to] = e.split('>');
      return { from: from!, to: to! };
    }),
  };
}

const codes = (graph: GraphInput) => validateGraph(graph).map((i) => i.code);

describe('validateGraph', () => {
  it('accepts a valid DAG', () => {
    expect(validateGraph(g(['a:s', 'b:s', 'c:s'], ['a>b', 'b>c']))).toEqual([]);
  });

  it('accepts a diamond (AND prerequisites) and a single node', () => {
    expect(validateGraph(g(['a:s', 'b:s', 'c:s', 'd:s'], ['a>b', 'a>c', 'b>d', 'c>d']))).toEqual(
      [],
    );
    expect(validateGraph(g(['a:s']))).toEqual([]);
  });

  it('finds a cycle and names only the nodes on it', () => {
    // a -> b -> c -> b; d hangs off the cycle but is not part of it
    const issues = validateGraph(g(['a:s', 'b:s', 'c:s', 'd:s'], ['a>b', 'b>c', 'c>b', 'c>d']));
    const cycle = issues.find((i) => i.code === 'cycle');
    expect(cycle?.nodeIds?.sort()).toEqual(['b', 'c']);
  });

  it('finds a cycle with no root at all', () => {
    expect(codes(g(['a:s', 'b:s'], ['a>b', 'b>a']))).toEqual(
      expect.arrayContaining(['cycle', 'no_root']),
    );
  });

  it('finds an isolated node', () => {
    const issues = validateGraph(g(['a:s', 'b:s', 'lonely:s'], ['a>b']));
    expect(issues).toEqual([expect.objectContaining({ code: 'isolated', nodeIds: ['lonely'] })]);
  });

  it('finds a node that cannot be reached from any root', () => {
    // r -> a is fine; x <-> y is a closed loop nothing leads into
    const issues = validateGraph(g(['r:s', 'a:s', 'x:s', 'y:s'], ['r>a', 'x>y', 'y>x']));
    const unreachable = issues.find((i) => i.code === 'unreachable');
    expect(unreachable?.nodeIds?.sort()).toEqual(['x', 'y']);
  });

  it('finds a node without a skill', () => {
    const issues = validateGraph(g(['a:s', 'b'], ['a>b']));
    expect(issues).toEqual([
      expect.objectContaining({ code: 'node_without_skill', nodeIds: ['b'] }),
    ]);
  });

  it('does not call a single node isolated, but an empty graph has no nodes', () => {
    expect(codes(g(['a:s']))).toEqual([]);
    expect(codes(g([]))).toEqual(['no_nodes']);
  });

  it('returns all problems at once, not just the first', () => {
    const found = codes(g(['a', 'b:s', 'c:s', 'lonely:s'], ['b>c', 'c>b']));
    expect(found).toEqual(
      expect.arrayContaining(['cycle', 'unreachable', 'isolated', 'node_without_skill']),
    );
  });

  it('ignores dangling and duplicate edges instead of crashing', () => {
    expect(validateGraph(g(['a:s', 'b:s'], ['a>b', 'a>b', 'a>ghost', 'b>b']))).toEqual([]);
  });
});

describe('layout helpers', () => {
  const diamond = g(['a:s', 'b:s', 'c:s', 'd:s'], ['a>b', 'a>c', 'b>d', 'c>d', 'a>d']);

  it('puts each node after its longest prerequisite chain', () => {
    expect(Object.fromEntries(nodeLayers(diamond))).toEqual({ a: 0, b: 1, c: 1, d: 2 });
  });

  it('does not loop forever on a cycle', () => {
    expect(nodeLayers(g(['a:s', 'b:s'], ['a>b', 'b>a'])).size).toBe(2);
  });

  it('opens roots and locks the rest as placeholder states', () => {
    expect(Object.fromEntries(placeholderNodeStates(diamond))).toEqual({
      a: 'available',
      b: 'locked',
      c: 'locked',
      d: 'locked',
    });
  });
});
