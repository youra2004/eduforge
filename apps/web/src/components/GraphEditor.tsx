'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Node } from '@xyflow/react';
import { sendJson } from '@/lib/client';
import { CourseGraph, type GraphNodeData } from './CourseGraph';

interface Skill {
  id: string;
  name: string;
  description: string;
}
interface EditorNode {
  id: string;
  title: string;
  summary: string;
  skillIds: string[];
}

/** The visual editor of the knowledge graph (F1-R6): drag nodes, draw prerequisites, edit nodes and skills. Every change is saved at once by the server. */
export function GraphEditor({
  versionId,
  flowNodes,
  nodes,
  edges,
  skills,
}: {
  versionId: string;
  flowNodes: Node<GraphNodeData>[];
  nodes: EditorNode[];
  edges: { from: string; to: string }[];
  skills: Skill[];
}) {
  const router = useRouter();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const title = new Map(nodes.map((n) => [n.id, n.title]));
  const selected = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const edgeKey = (e: { from: string; to: string }) => `${e.from}-${e.to}`;
  const selectedEdge = edges.find((e) => edgeKey(e) === selectedEdgeId) ?? null;

  /** Sends one change; on success the page reloads the graph from the server. Returns whether it worked. */
  async function edit(change: Record<string, unknown>) {
    setBusy(true);
    setErrors([]);
    const res = await sendJson(`/api/courses/versions/${versionId}/graph`, 'POST', change);
    setBusy(false);
    if (!res.ok) {
      setErrors(res.errors);
      // a refused drag or connection snaps back to the saved state
      router.refresh();
      return false;
    }
    router.refresh();
    return true;
  }

  async function addNode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    if (await edit({ op: 'add_node', title: String(data.get('title') ?? '') })) form.reset();
  }

  async function addSkill(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    if (await edit({ op: 'add_skill', name: String(data.get('name') ?? '') })) form.reset();
  }

  async function addEdge(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    await edit({ op: 'add_edge', from: String(data.get('from')), to: String(data.get('to')) });
  }

  async function saveNode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const data = new FormData(e.currentTarget);
    await edit({
      op: 'update_node',
      nodeId: selected.id,
      title: String(data.get('title') ?? ''),
      summary: String(data.get('summary') ?? ''),
      skillIds: data.getAll('skillIds').map(String),
    });
  }

  return (
    <section className="graph-editor" data-testid="graph-editor">
      <p className="hint">
        Редактор графа: перетягуйте вузли, щоб розставити їх, і тягніть від нижньої точки вузла до
        верхньої точки іншого, щоб задати передумову. Зміни зберігаються одразу.
      </p>
      {errors.length > 0 && (
        <ul role="alert" className="error" data-testid="editor-errors">
          {errors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      <CourseGraph
        nodes={flowNodes}
        edges={edges.map((e) => ({ id: edgeKey(e), source: e.from, target: e.to }))}
        editing={{
          selectedNodeId,
          selectedEdgeId,
          onSelectNode: (id) => {
            setSelectedNodeId(id);
            setSelectedEdgeId(null);
          },
          onSelectEdge: (id) => {
            setSelectedEdgeId(id);
            setSelectedNodeId(null);
          },
          onConnect: (from, to) => void edit({ op: 'add_edge', from, to }),
          onMove: (id, position) => void edit({ op: 'update_node', nodeId: id, position }),
        }}
      />

      {selectedEdge && (
        <p data-testid="selected-edge">
          Передумова: «{title.get(selectedEdge.from)}» → «{title.get(selectedEdge.to)}»{' '}
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={() => {
              void edit({ op: 'delete_edge', from: selectedEdge.from, to: selectedEdge.to });
              setSelectedEdgeId(null);
            }}
          >
            Видалити звʼязок
          </button>
        </p>
      )}

      <div className="editor-grid">
        <div>
          <h2>Вузли</h2>
          <form onSubmit={addNode} className="inline-form" data-testid="add-node-form">
            <label>
              Назва нового вузла
              <input type="text" name="title" required maxLength={200} />
            </label>
            <button type="submit" disabled={busy}>
              Додати вузол
            </button>
          </form>
          {selected ? (
            <form key={selected.id} onSubmit={saveNode} data-testid="node-form">
              <h3>Вузол «{selected.title}»</h3>
              <label>
                Назва
                <input
                  type="text"
                  name="title"
                  defaultValue={selected.title}
                  required
                  maxLength={200}
                />
              </label>
              <label>
                Короткий опис
                <textarea
                  name="summary"
                  defaultValue={selected.summary}
                  rows={3}
                  maxLength={2000}
                />
              </label>
              <fieldset className="options">
                <legend>Навички вузла</legend>
                {skills.length === 0 && (
                  <span className="muted">Спершу додайте навички курсу.</span>
                )}
                {skills.map((s) => (
                  <label key={s.id} className="check">
                    <input
                      type="checkbox"
                      name="skillIds"
                      value={s.id}
                      defaultChecked={selected.skillIds.includes(s.id)}
                    />
                    {s.name}
                  </label>
                ))}
              </fieldset>
              <div className="actions">
                <button type="submit" disabled={busy}>
                  Зберегти вузол
                </button>
                <Link href={`/courses/${versionId}/nodes/${selected.id}`}>
                  Матеріали та питання
                </Link>
                <button
                  type="button"
                  className="link danger"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !confirm(
                        `Видалити вузол «${selected.title}» разом з його матеріалами та питаннями?`,
                      )
                    )
                      return;
                    void edit({ op: 'delete_node', nodeId: selected.id });
                    setSelectedNodeId(null);
                  }}
                >
                  Видалити вузол
                </button>
              </div>
            </form>
          ) : (
            <p className="hint">Оберіть вузол на графі, щоб змінити його назву, опис і навички.</p>
          )}
        </div>

        <div>
          <h2>Навички курсу</h2>
          <ul className="editor-list" data-testid="skill-list">
            {skills.map((s) => (
              <SkillRow key={s.id} skill={s} busy={busy} onEdit={edit} />
            ))}
          </ul>
          <form onSubmit={addSkill} className="inline-form" data-testid="add-skill-form">
            <label>
              Нова навичка
              <input type="text" name="name" required maxLength={200} />
            </label>
            <button type="submit" disabled={busy}>
              Додати навичку
            </button>
          </form>

          <h2>Передумови</h2>
          <ul className="editor-list" data-testid="edge-list">
            {edges.map((e) => (
              <li key={edgeKey(e)}>
                {title.get(e.from)} → {title.get(e.to)}{' '}
                <button
                  type="button"
                  className="link danger"
                  disabled={busy}
                  aria-label={`Видалити передумову ${title.get(e.from)} → ${title.get(e.to)}`}
                  onClick={() => void edit({ op: 'delete_edge', from: e.from, to: e.to })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {nodes.length >= 2 && (
            <form onSubmit={addEdge} className="inline-form" data-testid="add-edge-form">
              <label>
                Спершу пройти
                <select name="from" required>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Щоб відкрити
                <select name="to" required defaultValue={nodes[1]?.id}>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={busy}>
                Додати передумову
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function SkillRow({
  skill,
  busy,
  onEdit,
}: {
  skill: Skill;
  busy: boolean;
  onEdit: (change: Record<string, unknown>) => Promise<boolean>;
}) {
  const [name, setName] = useState(skill.name);
  return (
    <li>
      <input
        type="text"
        value={name}
        aria-label={`Назва навички ${skill.name}`}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name !== skill.name) {
            void onEdit({ op: 'update_skill', skillId: skill.id, name });
          } else setName(skill.name);
        }}
        maxLength={200}
      />{' '}
      <button
        type="button"
        className="link danger"
        disabled={busy}
        aria-label={`Видалити навичку ${skill.name}`}
        onClick={() => void onEdit({ op: 'delete_skill', skillId: skill.id })}
      >
        ✕
      </button>
    </li>
  );
}
