import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { Mascot, type Mood } from './Mascot';

/** Three connected nodes: the knowledge graph in one glyph. */
export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect width="32" height="32" rx="9" style={{ fill: 'var(--text)' }} />
      <path
        d="M16 10.5C16 16 9 15.5 9 21.5M16 10.5C16 16 23 15.5 23 21.5"
        fill="none"
        style={{ stroke: 'var(--bg)' }}
        strokeOpacity=".5"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="16" cy="9.5" r="3.4" fill="#7b6dff" />
      <circle cx="9" cy="22" r="3" style={{ fill: 'var(--bg)' }} />
      <circle cx="23" cy="22" r="3" style={{ fill: 'var(--bg)' }} />
    </svg>
  );
}

/** Title block of a screen: optional way back, h1, one line of context and the screen's main actions. */
export function PageHeader({
  title,
  lead,
  back,
  actions,
  mood,
}: {
  title: ReactNode;
  lead?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  /** Puts the mascot next to the title, for the screens that welcome a student. */
  mood?: Mood;
}) {
  return (
    <>
      {back && (
        <Link href={back.href} className="back">
          <Icon name="arrow-left" size={15} />
          {back.label}
        </Link>
      )}
      <header className={mood ? 'page-head welcome' : 'page-head'}>
        {mood && <Mascot mood={mood} size={88} float follow />}
        <div>
          <h1>{title}</h1>
          {lead && <div className="lead">{lead}</div>}
        </div>
        {actions && <div className="head-actions">{actions}</div>}
      </header>
    </>
  );
}

/** An empty list says what is missing and, where there is one, what to do about it. */
export function EmptyState({
  icon = 'inbox',
  mood = 'think',
  title,
  children,
  action,
  testId,
}: {
  icon?: IconName;
  mood?: Mood;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="empty" data-testid={testId}>
      <span className="empty-art">
        <Mascot mood={mood} size={84} float />
        <span className="empty-icon">
          <Icon name={icon} size={16} />
        </span>
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Progress as a bar with its figures: "пройдено 3 з 8" and the share. */
export function Progress({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div className="progress-line">
      <div className="figures">
        <span>
          {label} <strong>{value}</strong> з {total}
        </span>
        <span>{pct} %</span>
      </div>
      <span
        className="bar"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${label} ${value} з ${total}`}
      >
        <span
          className={value === total && total > 0 ? 'fill ok' : 'fill'}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

const pipeline = ['Чернетка', 'Аудит', 'Готово до публікації', 'Опубліковано'] as const;
const pipelineStep: Record<string, number> = {
  draft: 0,
  changes_requested: 0,
  auditing: 1,
  expert_review: 1,
  ready_to_publish: 2,
  published: 3,
  archived: 4,
};

/** Where a course version is on its way to publication, for the people who own it. */
export function VersionPipeline({ status }: { status: string }) {
  const here = pipelineStep[status] ?? 0;
  return (
    <ol
      className="steps pipeline"
      aria-label="Шлях курсу до публікації"
      data-testid="version-pipeline"
    >
      {pipeline.map((label, i) => (
        <li
          key={label}
          className={i < here ? 'done' : i === here ? 'current' : ''}
          aria-current={i === here ? 'step' : undefined}
        >
          {label}
        </li>
      ))}
    </ol>
  );
}

/** Where a student stands, from the number of nodes passed. A label only: it changes nothing in the learning engine. */
const ranks = [
  { from: 0, title: 'Новачок' },
  { from: 1, title: 'Дослідник' },
  { from: 3, title: 'Знавець' },
  { from: 6, title: 'Майстер графа' },
] as const;

export function rankOf(nodesPassed: number) {
  const i = Math.max(
    0,
    ranks.findLastIndex((r) => nodesPassed >= r.from),
  );
  const next = ranks[i + 1];
  return { title: ranks[i]!.title, left: next ? next.from - nodesPassed : 0, next: next?.title };
}

/** Milestones the student has reached, derived from progress; the ones still ahead stay locked. */
export function Achievements({
  items,
}: {
  items: { icon: IconName; title: string; hint: string; done: boolean; tone: string }[];
}) {
  return (
    <ul className="achievements" data-testid="achievements">
      {items.map((a) => (
        <li key={a.title} className={a.done ? 'done' : 'locked'} data-tone={a.tone}>
          <span className="ach-icon">
            <Icon name={a.done ? a.icon : 'lock'} size={20} />
          </span>
          <strong>{a.title}</strong>
          <span className="hint">{a.hint}</span>
        </li>
      ))}
    </ul>
  );
}

/** The colourful side of the sign-in and sign-up screens: the mascot and what waits behind the door. */
export function AuthArt({ mood, title, points }: { mood: Mood; title: string; points: string[] }) {
  return (
    <aside className="auth-art" aria-hidden>
      <Mascot mood={mood} size={148} float follow />
      <h2>{title}</h2>
      <ul>
        {points.map((p) => (
          <li key={p}>
            <Icon name="check" size={14} />
            {p}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** The score of a finished test as a ring that fills up, next to the mascot's reaction. */
export function ScoreRing({ pct }: { pct: number }) {
  const n = Math.round(pct);
  return (
    <div className="score-ring" style={{ '--pct': n } as React.CSSProperties}>
      <span
        className="result-score count-up"
        style={{ '--n': n } as React.CSSProperties}
        data-suffix=" %"
        role="img"
        aria-label={`${n} %`}
      />
    </div>
  );
}
