export type CourseIssueCode =
  // import-only: the JSON shape and references
  | 'schema'
  | 'duplicate_key'
  | 'unknown_reference'
  | 'self_loop'
  | 'duplicate_edge'
  // graph validation (F1-R3)
  | 'no_nodes'
  | 'cycle'
  | 'no_root'
  | 'unreachable'
  | 'isolated'
  | 'node_without_skill';

export interface CourseIssue {
  code: CourseIssueCode;
  message: string;
  /** Where in the import JSON, e.g. `nodes.2.skills`. */
  path?: string;
  /** The nodes involved (ids, or keys for an import). */
  nodeIds?: string[];
}

export interface GraphInput {
  nodes: { id: string; skillIds: string[] }[];
  /** `from` is the prerequisite, `to` the node it unlocks (AND semantics, D-12). */
  edges: { from: string; to: string }[];
}

function adjacency({ nodes, edges }: GraphInput) {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const seen = new Set<string>();
  for (const { from, to } of edges) {
    // Dangling or repeated edges are the importer's concern; they must not crash the validator.
    if (!ids.has(from) || !ids.has(to) || from === to || seen.has(`${from}\0${to}`)) continue;
    seen.add(`${from}\0${to}`);
    out.get(from)!.push(to);
    indegree.set(to, indegree.get(to)! + 1);
  }
  return { out, indegree };
}

/** Kahn's algorithm. `order` is a topological order of the acyclic part; `rest` is what could not be ordered. */
function kahn(out: Map<string, string[]>, indegree: Map<string, number>) {
  const left = new Map(indegree);
  const queue = [...left].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    order.push(id);
    for (const next of out.get(id)!) {
      const d = left.get(next)! - 1;
      left.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  const done = new Set(order);
  return { order, rest: [...left.keys()].filter((id) => !done.has(id)) };
}

/** Deterministic graph checks (F1-R3). Returns every problem found, an empty list when the graph is fine. */
export function validateGraph(graph: GraphInput): CourseIssue[] {
  const issues: CourseIssue[] = [];
  if (graph.nodes.length === 0) {
    return [{ code: 'no_nodes', message: 'The course has no nodes.' }];
  }
  const { out, indegree } = adjacency(graph);
  const roots = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);

  const { rest } = kahn(out, indegree);
  if (rest.length > 0) {
    // `rest` also holds nodes merely downstream of a cycle; peel those off (nodes with no
    // successor left in `rest`) so the report names only nodes that sit on a cycle.
    const onCycle = new Set(rest);
    for (let changed = true; changed;) {
      changed = false;
      for (const id of onCycle) {
        if (out.get(id)!.every((next) => !onCycle.has(next))) {
          onCycle.delete(id);
          changed = true;
        }
      }
    }
    const ids = [...onCycle];
    issues.push({
      code: 'cycle',
      message: `Prerequisites form a cycle: ${ids.join(', ')}.`,
      nodeIds: ids,
    });
  }

  if (roots.length === 0) {
    issues.push({ code: 'no_root', message: 'No root node: every node has a prerequisite.' });
  }

  const reached = new Set(roots);
  const stack = [...roots];
  while (stack.length > 0) {
    for (const next of out.get(stack.pop()!)!) {
      if (!reached.has(next)) {
        reached.add(next);
        stack.push(next);
      }
    }
  }
  const unreachable = graph.nodes.map((n) => n.id).filter((id) => !reached.has(id));
  if (unreachable.length > 0) {
    issues.push({
      code: 'unreachable',
      message: `Not reachable from any root: ${unreachable.join(', ')}.`,
      nodeIds: unreachable,
    });
  }

  if (graph.nodes.length > 1) {
    const hasIn = new Set([...indegree].filter(([, d]) => d > 0).map(([id]) => id));
    const isolated = graph.nodes
      .map((n) => n.id)
      .filter((id) => !hasIn.has(id) && out.get(id)!.length === 0);
    if (isolated.length > 0) {
      issues.push({
        code: 'isolated',
        message: `Isolated nodes (no edges): ${isolated.join(', ')}.`,
        nodeIds: isolated,
      });
    }
  }

  const noSkill = graph.nodes.filter((n) => n.skillIds.length === 0).map((n) => n.id);
  if (noSkill.length > 0) {
    issues.push({
      code: 'node_without_skill',
      message: `Nodes without a skill: ${noSkill.join(', ')}.`,
      nodeIds: noSkill,
    });
  }

  return issues;
}

/** Longest distance from a root, per node: the column a layered drawing puts it in. Cyclic leftovers get 0. */
export function nodeLayers(graph: GraphInput): Map<string, number> {
  const { out, indegree } = adjacency(graph);
  const layers = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  for (const id of kahn(out, indegree).order) {
    for (const next of out.get(id)!)
      layers.set(next, Math.max(layers.get(next)!, layers.get(id)! + 1));
  }
  return layers;
}

export type PlaceholderNodeState = 'available' | 'locked';

/** Stand-in states for the read-only graph view until progress exists (M05): roots open, the rest locked. */
export function placeholderNodeStates(graph: GraphInput): Map<string, PlaceholderNodeState> {
  const { indegree } = adjacency(graph);
  return new Map(graph.nodes.map((n) => [n.id, indegree.get(n.id) === 0 ? 'available' : 'locked']));
}
