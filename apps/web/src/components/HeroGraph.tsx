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

const stateStyle = {
  passed: { stroke: '#a9dfc6', fill: '#f2fbf7', accent: '#0f7b55', label: 'Пройдено' },
  in_progress: { stroke: '#4b3cf0', fill: '#f6f5ff', accent: '#4b3cf0', label: 'У процесі' },
  locked: { stroke: '#d3d6de', fill: '#f3f4f6', accent: '#9a9fad', label: 'Заблокований' },
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
            <rect
              width={W}
              height={H}
              rx="12"
              fill={s.fill}
              stroke={s.stroke}
              strokeWidth={n.state === 'in_progress' ? 1.6 : 1}
              strokeDasharray={n.state === 'locked' ? '4 3' : undefined}
            />
            <rect x="0" y="12" width="3" height={H - 24} rx="1.5" fill={s.accent} />
            <text
              x="16"
              y="23"
              fontSize="12.5"
              fontWeight="650"
              fill={n.state === 'locked' ? '#6a6f7e' : '#0f1115'}
            >
              {n.title}
            </text>
            <text x="16" y="38" fontSize="10.5" fill="#6a6f7e">
              {n.skills}
            </text>
            <circle cx="19" cy="51" r="3" fill={s.accent} />
            <text x="27" y="54.5" fontSize="10.5" fontWeight="600" fill={s.accent}>
              {s.label}
            </text>
          </g>
        );
      })}

      {/* the tutor's hint and the mastery gauge sit beside the node being learned */}
      <g transform="translate(372 236)">
        <rect width="162" height="92" rx="14" fill="#fff" stroke="#e6e8ed" />
        <circle cx="18" cy="20" r="9" fill="#efedff" />
        <path
          d="M14 20l3 3 5-6"
          fill="none"
          stroke="#4b3cf0"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="34" y="24" fontSize="11" fontWeight="650" fill="#0f1115">
          Репетитор
        </text>
        <text x="14" y="46" fontSize="10.5" fill="#3b404b">
          Що змінюється на кожній
        </text>
        <text x="14" y="60" fontSize="10.5" fill="#3b404b">
          ітерації циклу?
        </text>
        <rect x="14" y="72" width="134" height="6" rx="3" fill="#eceef2" />
        <rect x="14" y="72" width="86" height="6" rx="3" fill="#4b3cf0" />
      </g>
    </svg>
  );
}
