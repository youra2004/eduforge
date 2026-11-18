import { describe, expect, it } from 'vitest';
import {
  banForLevel,
  browserSeverity,
  combineBans,
  frameEvents,
  isBrowserEvent,
  keystrokeSignals,
  riskScore,
  type KeystrokeSummary,
} from './rules';

const T0 = new Date('2026-03-01T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('strike ladder (F9-R6, D-19)', () => {
  it('1st strike bans for 7 days, 2nd for 30 days, 3rd for good', () => {
    expect(banForLevel(1, T0)).toEqual({ forever: false, until: new Date(T0.getTime() + 7 * DAY) });
    expect(banForLevel(2, T0)).toEqual({
      forever: false,
      until: new Date(T0.getTime() + 30 * DAY),
    });
    expect(banForLevel(3, T0)).toEqual({ forever: true, until: null });
    expect(banForLevel(4, T0).forever).toBe(true);
  });

  it('shortens the ban with TIME_SCALE like every pause (P2)', () => {
    expect(banForLevel(1, T0, 1440).until).toEqual(new Date(T0.getTime() + (7 * DAY) / 1440));
  });

  it('keeps the longest ban of the strikes that stand; none means no ban', () => {
    const a = banForLevel(1, T0);
    const b = banForLevel(2, T0);
    expect(combineBans([a, b])).toEqual(b);
    expect(combineBans([a, banForLevel(3, T0)])).toEqual({ forever: true, until: null });
    expect(combineBans([])).toEqual({ forever: false, until: null });
  });
});

describe('what the browser may report (F9-R2, F9-R8)', () => {
  it('accepts only known types', () => {
    expect(isBrowserEvent('fullscreen_exit')).toBe(true);
    expect(isBrowserEvent('face_mismatch')).toBe(false); // server-derived: a client cannot claim it
    expect(isBrowserEvent('toString')).toBe(false);
  });

  it('losing focus is hard only after the grace period', () => {
    expect(browserSeverity('focus_lost', { awayMs: 2999 }, 3000)).toBe('info');
    expect(browserSeverity('focus_lost', { awayMs: 3000 }, 3000)).toBe('hard');
    expect(browserSeverity('focus_lost', {}, 3000)).toBe('info');
  });

  it.each(['fullscreen_exit', 'devtools_open', 'copy', 'paste'] as const)('%s is hard', (type) => {
    expect(browserSeverity(type, {}, 3000)).toBe('hard');
  });

  it.each(['face_missing', 'multiple_faces', 'head_turn'] as const)('%s is soft', (type) => {
    expect(browserSeverity(type, {}, 3000)).toBe('soft');
  });
});

describe('risk score (F9-R3)', () => {
  it('adds the weights of soft events only', () => {
    expect(riskScore([])).toBe(0);
    expect(
      riskScore([
        { type: 'face_missing', severity: 'soft' },
        { type: 'phone', severity: 'soft' },
        { type: 'snapshot_ok', severity: 'info' },
        { type: 'paste', severity: 'hard' },
      ]),
    ).toBe(65);
  });
});

describe('frame verdict (F9-R4)', () => {
  it('a clean frame gives no event', () => {
    expect(
      frameEvents({ match: true, phone: false, secondPerson: false, gazeAway: false }),
    ).toEqual([]);
  });

  it('names each thing the checks found', () => {
    expect(frameEvents({ match: false, phone: true, secondPerson: true, gazeAway: true })).toEqual([
      'face_mismatch',
      'second_person',
      'phone',
      'gaze_away',
    ]);
  });
});

describe('keystroke heuristics (F9-R5, D-24)', () => {
  const human = (n: number, extra: Partial<KeystrokeSummary> = {}): KeystrokeSummary => ({
    intervalsMs: Array.from({ length: n }, (_, i) => 120 + ((i * 53) % 190)),
    corrections: 2,
    chars: n + 1,
    keys: n + 1,
    ...extra,
  });

  it('an ordinary rhythm with corrections gives no signal', () => {
    expect(keystrokeSignals(human(40))).toEqual([]);
  });

  it('text that appeared without key presses is a paste', () => {
    expect(keystrokeSignals(human(10, { chars: 300, keys: 10 }))).toEqual(['keystroke_paste']);
    expect(keystrokeSignals(human(10, { chars: 30, keys: 10 }))).toEqual([]); // under the limit: autocomplete, say
  });

  it('typing faster than a person can is a signal', () => {
    expect(keystrokeSignals({ ...human(30), intervalsMs: Array(30).fill(20) })).toEqual([
      'keystroke_too_fast',
    ]);
  });

  it('a perfectly even rhythm with no corrections is a signal; with a correction it is not', () => {
    const even = { ...human(30), intervalsMs: Array(30).fill(140), corrections: 0 };
    expect(keystrokeSignals(even)).toEqual(['keystroke_too_uniform']);
    expect(keystrokeSignals({ ...even, corrections: 1 })).toEqual([]);
  });

  it('too few intervals say nothing about a rhythm', () => {
    expect(keystrokeSignals({ ...human(5), intervalsMs: Array(5).fill(10) })).toEqual([]);
  });
});
