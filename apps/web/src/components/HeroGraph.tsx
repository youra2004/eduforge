/** An illustration of the product's central idea: a knowledge graph whose nodes open as understanding is shown. */
const W = 150;
const H = 62;

const nodes = [
  { x: 190, y: 10, title: 'Перші кроки', skills: 'Ввід і вивід', state: 'passed' },
  { x: 30, y: 130, title: 'Змінні та типи', skills: 'Типи даних', state: 'passed' },
  { x: 350, y: 130, title: 'Умови', skills: 'Умовні конструкції', state: 'passed' },
  { x: 190, y: 250, title: 'Цикли', skills: 'Цикли · Умови', state: 'in_progress' },
  { x: 190, y: 370, title: 'Списки та словники', skills: 'Списки · Словники', state: 'locked' },
] as const;

// Colors are theme variables, so the illustration follows light and dark.
const stateStyle = {
  passed: {
    stroke: 'var(--ok-line)',
    fill: 'var(--ok-soft)',
    accent: 'var(--ok)',
    label: 'Пройдено',
  },
  in_progress: {
    stroke: 'var(--accent)',
    fill: 'var(--accent-soft)',
    accent: 'var(--accent)',
    label: 'У процесі',
  },
  locked: {
    stroke: 'var(--line-strong)',
    fill: 'var(--surface-2)',
    accent: 'var(--muted-2)',
    label: 'Заблокований',
  },
} as const;

export function HeroGraph() {
  return (
    <svg
      className="hero-graph"
      viewBox="0 0 540 450"
      role="img"
      aria-label="Приклад графа знань: три пройдені вузли відкривають вузол «Цикли», за ним — закритий вузол"
    >
      <path className="edge" d="M265 72C265 101 105 101 105 130" />
      <path className="edge" d="M265 72C265 101 425 101 425 130" />
      <path className="edge" d="M105 192C105 221 265 221 265 250" />
      <path className="edge" d="M425 192C425 221 265 221 265 250" />
      <path className="edge live" d="M265 312V370" />
      {nodes.map((n) => {
        const s = stateStyle[n.state];
        return (
          <g key={n.title} transform={`translate(${n.x} ${n.y})`}>
            <rect width={W} height={H} rx="16" style={{ fill: 'var(--card)' }} />
            {n.state === 'in_progress' && (
              <rect className="pulse-ring" width={W} height={H} rx="16" fill="none" />
            )}
            <rect
              width={W}
              height={H}
              rx="16"
              style={{ fill: s.fill, stroke: s.stroke }}
              strokeWidth={n.state === 'in_progress' ? 2.4 : 1.6}
              strokeDasharray={n.state === 'locked' ? '4 3' : undefined}
            />
            <rect x="0" y="12" width="3" height={H - 24} rx="1.5" style={{ fill: s.accent }} />
            <text
              x="16"
              y="23"
              fontSize="12.5"
              fontWeight="650"
              style={{ fill: n.state === 'locked' ? 'var(--muted)' : 'var(--text)' }}
            >
              {n.title}
            </text>
            <text x="16" y="38" fontSize="10.5" style={{ fill: 'var(--muted)' }}>
              {n.skills}
            </text>
            {n.state === 'passed' && (
              <g className="badge-pop" transform={`translate(${W - 4} 2)`}>
                <circle
                  r="11"
                  style={{ fill: 'var(--ok)', stroke: 'var(--card)' }}
                  strokeWidth="3"
                />
                <path
                  d="M-4.5 0.5l3 3 6-6.5"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            )}
            {n.state === 'locked' && (
              <g transform={`translate(${W - 24} ${H - 24})`} style={{ stroke: 'var(--muted-2)' }}>
                <rect x="1" y="7" width="12" height="9" rx="2.5" fill="none" strokeWidth="1.7" />
                <path d="M4 7V5a3 3 0 0 1 6 0v2" fill="none" strokeWidth="1.7" />
              </g>
            )}
            <circle cx="19" cy="51" r="3" style={{ fill: s.accent }} />
            <text x="27" y="54.5" fontSize="10.5" fontWeight="600" style={{ fill: s.accent }}>
              {s.label}
            </text>
          </g>
        );
      })}

      {/* the tutor's hint and the mastery gauge sit beside the node being learned */}
      <g transform="translate(372 236)">
        <rect
          width="162"
          height="92"
          rx="18"
          style={{ fill: 'var(--card)', stroke: 'var(--line)' }}
        />
        <circle cx="18" cy="20" r="9" style={{ fill: 'var(--accent-soft)' }} />
        <path
          d="M14 20l3 3 5-6"
          fill="none"
          style={{ stroke: 'var(--accent)' }}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="34" y="24" fontSize="11" fontWeight="650" style={{ fill: 'var(--text)' }}>
          Репетитор
        </text>
        <text x="14" y="46" fontSize="10.5" style={{ fill: 'var(--text-2)' }}>
          Що змінюється на кожній
        </text>
        <text x="14" y="60" fontSize="10.5" style={{ fill: 'var(--text-2)' }}>
          ітерації циклу?
        </text>
        <rect x="14" y="72" width="134" height="6" rx="3" style={{ fill: 'var(--surface-3)' }} />
        <rect x="14" y="72" width="86" height="6" rx="3" style={{ fill: 'var(--accent)' }} />
      </g>
    </svg>
  );
}
