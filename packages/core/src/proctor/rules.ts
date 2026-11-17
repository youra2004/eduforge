import type { EventSeverity, ProctorSource } from '@eduforge/db';
import { scaleSeconds } from '../time';

/**
 * Pure rules of the proctoring (F9). The browser only reports what it saw; the severity of every event, the risk
 * score and the strike are decided here, on the server (P1, F9-R8).
 */

export interface EventKind {
  source: ProctorSource;
  severity: EventSeverity;
  /** Share of the risk score a soft signal adds (F9-R3). */
  weight: number;
}

// Hard events (F9-R2): the attempt stops and a strike follows at once.
const hard = (source: ProctorSource): EventKind => ({ source, severity: 'hard', weight: 0 });
const soft = (source: ProctorSource, weight: number): EventKind => ({
  source,
  severity: 'soft',
  weight,
});
const info = (source: ProctorSource): EventKind => ({ source, severity: 'info', weight: 0 });

/** What the browser may report. Anything else is refused, so a client cannot invent a type or a severity. */
export const BROWSER_EVENTS = {
  fullscreen_exit: hard('browser'),
  focus_lost: hard('browser'),
  devtools_open: hard('browser'),
  copy: hard('browser'),
  paste: hard('browser'),
  face_missing: soft('browser', 15),
  multiple_faces: soft('browser', 30),
  head_turn: soft('browser', 10),
  camera_ready: info('browser'),
  fullscreen_enter: info('browser'),
  focus_regained: info('browser'),
} as const satisfies Record<string, EventKind>;
export type BrowserEventType = keyof typeof BROWSER_EVENTS;

/** Events the server derives itself: from a checked frame, from the typing rhythm, from how the session went. */
export const SERVER_EVENTS = {
  face_mismatch: soft('frame', 60),
  second_person: soft('frame', 50),
  phone: soft('frame', 50),
  gaze_away: soft('frame', 20),
  keystroke_paste: soft('keystroke', 25),
  keystroke_too_fast: soft('keystroke', 20),
  keystroke_too_uniform: soft('keystroke', 20),
  reference_retaken: soft('server', 30),
  snapshot_ok: info('frame'),
  snapshot_failed: info('frame'),
  attempt_stopped: info('server'),
  strike_created: info('server'),
  strike_decision: info('server'),
  appeal: info('server'),
} as const satisfies Record<string, EventKind>;
export type ServerEventType = keyof typeof SERVER_EVENTS;

export const EVENT_KINDS: Record<string, EventKind> = { ...BROWSER_EVENTS, ...SERVER_EVENTS };

export function isBrowserEvent(type: string): type is BrowserEventType {
  return Object.hasOwn(BROWSER_EVENTS, type);
}

/** Events that carry a frame worth keeping as evidence (F9-R7). */
export const FRAME_EVIDENCE_TYPES: ServerEventType[] = [
  'face_mismatch',
  'second_person',
  'phone',
  'gaze_away',
];

/**
 * The severity the server gives an event the browser reported. Losing focus counts only after the grace period
 * (F9-R2); a shorter one is logged as information.
 */
export function browserSeverity(
  type: BrowserEventType,
  payload: { awayMs?: unknown },
  focusGraceMs: number,
): EventSeverity {
  if (type === 'focus_lost') {
    const away = typeof payload.awayMs === 'number' ? payload.awayMs : 0;
    return away >= focusGraceMs ? 'hard' : 'info';
  }
  return BROWSER_EVENTS[type].severity;
}

/** The risk score of an attempt: the sum of the weights of its soft events (F9-R3). Hard events do not add; they strike. */
export function riskScore(events: { type: string; severity: EventSeverity }[]): number {
  return events
    .filter((e) => e.severity === 'soft')
    .reduce((sum, e) => sum + (EVENT_KINDS[e.type]?.weight ?? 0), 0);
}

// ---------------------------------------------------------------- strikes (F9-R6, D-19)

const DAY_SECONDS = 24 * 60 * 60;
/** 1st confirmed strike: 7 days, 2nd: 30 days, 3rd (and after): for good. Exams only. */
export const STRIKE_LADDER_DAYS = [7, 30] as const;

export interface Ban {
  forever: boolean;
  until: Date | null;
}

/** The ban a strike of `level` (1, 2, 3...) brings, from `from`. Durations shrink with TIME_SCALE like every pause (P2). */
export function banForLevel(level: number, from: Date, timeScale = 1): Ban {
  const days = STRIKE_LADDER_DAYS[level - 1];
  if (days === undefined) return { forever: true, until: null };
  return {
    forever: false,
    until: new Date(from.getTime() + scaleSeconds(days * DAY_SECONDS, timeScale) * 1000),
  };
}

/** The ban in force given the strikes that still stand: the longest of them, or for good. */
export function combineBans(bans: Ban[]): Ban {
  if (bans.some((b) => b.forever)) return { forever: true, until: null };
  const untils = bans.map((b) => b.until).filter((d): d is Date => d !== null);
  return {
    forever: false,
    until: untils.length ? new Date(Math.max(...untils.map((d) => d.getTime()))) : null,
  };
}

// ---------------------------------------------------------------- keystroke (F9-R5, D-24)

/** What the browser sends about one answer's typing: intervals between keys, never the characters. */
export interface KeystrokeSummary {
  intervalsMs: number[];
  /** Keys that edit (backspace, delete). */
  corrections: number;
  /** Length of the text at the end. */
  chars: number;
  /** Key presses that were counted (printable keys). */
  keys: number;
}

export const KEYSTROKE_LIMITS = {
  /** Fewer intervals say nothing about a rhythm. */
  minIntervals: 15,
  /** A person does not type faster than this on average (about 20 characters a second). */
  fastMeanMs: 50,
  /** Variation (standard deviation / mean) below this is machine-regular. */
  uniformCv: 0.12,
  /** Text that appeared without key presses: more than this many characters is a paste. */
  pasteChars: 25,
} as const;

/** F9-R5: the soft signals one answer's typing gives. No automatic ban follows from them. */
export function keystrokeSignals(
  s: KeystrokeSummary,
): ('keystroke_paste' | 'keystroke_too_fast' | 'keystroke_too_uniform')[] {
  const out: ReturnType<typeof keystrokeSignals> = [];
  const L = KEYSTROKE_LIMITS;
  if (s.chars - s.keys > L.pasteChars) out.push('keystroke_paste');
  if (s.intervalsMs.length >= L.minIntervals) {
    const mean = s.intervalsMs.reduce((a, b) => a + b, 0) / s.intervalsMs.length;
    const sd = Math.sqrt(
      s.intervalsMs.reduce((a, b) => a + (b - mean) ** 2, 0) / s.intervalsMs.length,
    );
    if (mean < L.fastMeanMs) out.push('keystroke_too_fast');
    // Real typing is uneven and has corrections; a long run without either is a script.
    else if (mean > 0 && sd / mean < L.uniformCv && s.corrections === 0) {
      out.push('keystroke_too_uniform');
    }
  }
  return out;
}

// ---------------------------------------------------------------- frames (F9-R4)

export interface FrameChecks {
  match: boolean;
  phone: boolean;
  secondPerson: boolean;
  gazeAway: boolean;
}

/** The soft events a checked frame gives; none means a clean frame, which is stored nowhere (D-27). */
export function frameEvents(c: FrameChecks): ServerEventType[] {
  const out: ServerEventType[] = [];
  if (!c.match) out.push('face_mismatch');
  if (c.secondPerson) out.push('second_person');
  if (c.phone) out.push('phone');
  if (c.gazeAway) out.push('gaze_away');
  return out;
}
