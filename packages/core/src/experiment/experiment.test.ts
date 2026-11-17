import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../learning/assemble';
import { assignmentsOf, CELLS, cellIndex, chooseCell } from './assign';
import { activeSeconds, assertNoPii, toCsv } from './export';
import { moduleStep, type ModuleFacts } from './flow';
import { normalizedGain } from './gain';

/** Joins N participants one after another and counts how many landed in each cell. */
function allocate(n: number, seed = 7) {
  const rng = mulberry32(seed);
  const counts = CELLS.map(() => 0);
  const people = [];
  for (let i = 0; i < n; i++) {
    const cell = chooseCell(counts, rng);
    counts[cellIndex(cell)]!++;
    people.push(assignmentsOf(cell));
  }
  return { counts, people };
}

describe('counterbalancing (D-30)', () => {
  it.each([4, 8, 40, 100])('with N = %i the four cells are exactly even', (n) => {
    const { counts } = allocate(n);
    expect(counts).toEqual([n / 4, n / 4, n / 4, n / 4]);
  });

  it.each([1, 2, 3, 5, 7, 13, 41, 42, 43])('with N = %i no cell is more than one ahead', (n) => {
    const { counts } = allocate(n);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('splits conditions per topic and per period evenly', () => {
    const { people } = allocate(40);
    const count = (pred: (a: ReturnType<typeof assignmentsOf>[number]) => boolean) =>
      people.flat().filter(pred).length;
    // topic A: method for half; period 1: method for half; first topic: A for half
    expect(count((a) => a.module === 'A' && a.condition === 'method')).toBe(20);
    expect(count((a) => a.module === 'B' && a.condition === 'method')).toBe(20);
    expect(count((a) => a.period === 1 && a.condition === 'method')).toBe(20);
    expect(count((a) => a.period === 1 && a.module === 'A')).toBe(20);
  });

  it('gives every participant both topics, one of each condition, in periods 1 and 2', () => {
    for (const cell of CELLS) {
      const a = assignmentsOf(cell);
      expect(a.map((x) => x.module).sort()).toEqual(['A', 'B']);
      expect(a.map((x) => x.condition).sort()).toEqual(['control', 'method']);
      expect(a.map((x) => x.period).sort()).toEqual([1, 2]);
      expect(a.find((x) => x.period === 1)!.module).toBe(
        cell.orderVariant === 'A_then_B' ? 'A' : 'B',
      );
    }
  });

  it('is reproducible for the same seed', () => {
    expect(allocate(30, 3).counts).toEqual(allocate(30, 3).counts);
    expect(allocate(13, 1).people).toEqual(allocate(13, 1).people);
  });
});

describe('normalized gain', () => {
  it('is (post − pre) / (1 − pre)', () => {
    expect(normalizedGain(0.4, 0.7)).toBeCloseTo(0.5);
    expect(normalizedGain(0, 0.6)).toBeCloseTo(0.6);
    expect(normalizedGain(0.5, 1)).toBe(1);
  });
  it('can be negative and zero', () => {
    expect(normalizedGain(0.5, 0.25)).toBeCloseTo(-0.5);
    expect(normalizedGain(0.3, 0.3)).toBe(0);
  });
  it('is undefined when the pre-test was already perfect', () => {
    expect(normalizedGain(1, 1)).toBeNull();
    expect(normalizedGain(1, 0.8)).toBeNull();
  });
});

const NOW = new Date('2026-03-10T10:00:00Z');
const facts = (over: Partial<ModuleFacts> = {}): ModuleFacts => ({
  previousDone: true,
  pretestDone: false,
  learningFinished: false,
  posttestSubmittedAt: null,
  surveyDone: false,
  delayedDone: false,
  ...over,
});

describe('moduleStep', () => {
  const DELAY = 3600;
  it('walks pre-test → learning → post-test → survey → wait → delayed → complete', () => {
    const steps = [
      facts(),
      facts({ pretestDone: true }),
      facts({ pretestDone: true, learningFinished: true }),
      facts({ pretestDone: true, learningFinished: true, posttestSubmittedAt: NOW }),
      facts({
        pretestDone: true,
        learningFinished: true,
        posttestSubmittedAt: NOW,
        surveyDone: true,
      }),
    ].map((f) => moduleStep(f, DELAY, NOW));
    expect(steps).toEqual(['pretest', 'learning', 'posttest', 'survey', 'delayed_wait']);
    const done = facts({
      pretestDone: true,
      learningFinished: true,
      posttestSubmittedAt: NOW,
      surveyDone: true,
    });
    expect(moduleStep(done, DELAY, new Date(NOW.getTime() + DELAY * 1000 - 1))).toBe(
      'delayed_wait',
    );
    expect(moduleStep(done, DELAY, new Date(NOW.getTime() + DELAY * 1000))).toBe('delayed');
    expect(moduleStep({ ...done, delayedDone: true }, DELAY, NOW)).toBe('complete');
  });
  it('keeps the second topic waiting until the first one is done', () => {
    expect(moduleStep(facts({ previousDone: false }), DELAY, NOW)).toBe('waiting');
    expect(moduleStep(facts({ previousDone: false, pretestDone: true }), DELAY, NOW)).toBe(
      'learning',
    );
  });
});

describe('export column check (NFR-2)', () => {
  it('refuses columns that identify a person', () => {
    for (const c of [
      'email',
      'user_id',
      'display_name',
      'name',
      'Email',
      'student_email',
      'password_hash',
    ]) {
      expect(() => assertNoPii(['participant_code', c])).toThrow(/personal columns/);
    }
  });
  it('accepts the export columns', () => {
    expect(() =>
      assertNoPii([
        'participant_code',
        'module',
        'event',
        'skill_id',
        'question_id',
        'survey_help',
      ]),
    ).not.toThrow();
  });
  it('quotes cells, and defuses spreadsheet formulas', () => {
    const csv = toCsv({
      columns: ['participant_code', 'props'],
      rows: [
        ['P-1', '{"a":1,"b":"x"}'],
        ['P-2', '=1+1'],
        ['P-3', null],
      ],
    });
    expect(csv).toBe(`participant_code,props\nP-1,"{""a"":1,""b"":""x""}"\nP-2,'=1+1\nP-3,\n`);
  });
});

describe('activeSeconds (learning time from heartbeats)', () => {
  const at = (...s: number[]) => s.map((x) => new Date(NOW.getTime() + x * 1000));
  it('counts the first beat as one interval and each later one by its gap', () => {
    expect(activeSeconds([], 30)).toBe(0);
    expect(activeSeconds(at(0), 30)).toBe(30);
    expect(activeSeconds(at(0, 30, 60), 30)).toBe(90);
  });
  it('gives a burst of beats almost nothing, and does not count a long pause', () => {
    expect(activeSeconds(at(0, 0.1, 0.2, 0.3, 0.4), 30)).toBeCloseTo(30.4);
    expect(activeSeconds(at(0, 3600), 30)).toBe(90); // the hour away counts as two intervals at most
  });
});
