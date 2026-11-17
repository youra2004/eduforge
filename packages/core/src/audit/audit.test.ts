import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import {
  DEFAULT_RATING_CONFIG,
  aiScore,
  medianRun,
  rate,
  volumeCap,
  type AuditLevel,
  type RatingConfig,
} from './rating';
import { validateDecision, CHECKLIST_ITEMS } from './review';
import { canTransition, versionTransitions } from './transitions';

const cfg: RatingConfig = DEFAULT_RATING_CONFIG;
// A course big enough that the volume cap does not matter.
const BIG = 30;

describe('aiScore (F4-R5)', () => {
  it.each([
    // [level, hardness, score]: the edges of each band
    ['junior', 0, 1],
    ['junior', 1, 3],
    ['middle', 0, 4],
    ['middle', 1, 6],
    ['senior', 0, 7],
    ['senior', 1, 9],
    ['expert', 0.3, 10],
  ] as [AuditLevel, number, number][])(
    '%s with hardness %s scores %s',
    (level, hardness, score) => {
      expect(aiScore(level, hardness, cfg)).toBe(score);
    },
  );

  it('rounds inside the band and never leaves it', () => {
    expect(aiScore('middle', 0.5, cfg)).toBe(5);
    expect(aiScore('middle', 0.24, cfg)).toBe(4);
    expect(aiScore('senior', 0.74, cfg)).toBe(8);
    expect(aiScore('junior', -1, cfg)).toBe(1);
    expect(aiScore('senior', 7, cfg)).toBe(9);
  });

  it('follows the configured bands', () => {
    const wide: RatingConfig = {
      ...cfg,
      bands: { junior: [1, 2], middle: [3, 7], senior: [8, 9] },
    };
    expect(aiScore('middle', 1, wide)).toBe(7);
  });
});

describe('volumeCap (F4-R1)', () => {
  it.each([
    [1, 3],
    [5, 3],
    [6, 6],
    [11, 6],
    [12, 9],
    [19, 9],
    [20, 10],
    [200, 10],
  ])('%s nodes cap the rating at %s', (nodes, cap) => {
    expect(volumeCap(nodes, cfg.volumeCaps)).toBe(cap);
  });
});

describe('rate: final = min(ai_score, volume_cap) (D-08)', () => {
  it('lowers the score when the course is too small and says so', () => {
    const r = rate('senior', 1, 5, cfg);
    expect(r).toMatchObject({ aiScore: 9, volumeCap: 3, final: 3, limitedByVolume: true });
    expect(r.needsExpert).toBe(false);
  });

  it('keeps the score when the cap is not the limit', () => {
    expect(rate('middle', 0.5, 8, cfg)).toMatchObject({ final: 5, limitedByVolume: false });
  });

  it('sends rating 10 to an expert, but only when the size allows 10', () => {
    expect(rate('expert', 1, BIG, cfg)).toMatchObject({ final: 10, needsExpert: true });
    // an expert-level course of 15 nodes is capped at 9: no expert review needed
    expect(rate('expert', 1, 15, cfg)).toMatchObject({ final: 9, needsExpert: false });
  });

  it('gives a course without junior-level depth a 1', () => {
    expect(rate('junior', 0, BIG, cfg).final).toBe(1);
  });
});

describe('medianRun (F4-R4)', () => {
  it('takes the middle level and the middle hardness of the runs', () => {
    expect(
      medianRun([
        { level: 'senior', hardness: 0.9 },
        { level: 'middle', hardness: 0.4 },
        { level: 'middle', hardness: 0.5 },
        { level: 'expert', hardness: 1 },
        { level: 'middle', hardness: 0.6 },
      ]),
    ).toEqual({ level: 'middle', hardness: 0.6 });
  });

  it('ignores one outlier', () => {
    const outlier = medianRun([
      { level: 'expert', hardness: 1 },
      { level: 'junior', hardness: 0.2 },
      { level: 'junior', hardness: 0.3 },
      { level: 'junior', hardness: 0.25 },
      { level: 'junior', hardness: 0.1 },
    ]);
    expect(outlier.level).toBe('junior');
    expect(outlier.hardness).toBe(0.25);
  });

  it('never rounds a tie up: the lower level, the mean hardness', () => {
    expect(
      medianRun([
        { level: 'senior', hardness: 0.8 },
        { level: 'middle', hardness: 0.2 },
      ]),
    ).toEqual({ level: 'middle', hardness: 0.5 });
  });

  it('needs at least one run', () => {
    expect(() => medianRun([])).toThrow();
  });
});

describe('version states (F4)', () => {
  it('follows draft → auditing → changes_requested | ready_to_publish | expert_review → published', () => {
    expect(canTransition('draft', 'auditing')).toBe(true);
    expect(canTransition('auditing', 'changes_requested')).toBe(true);
    expect(canTransition('auditing', 'ready_to_publish')).toBe(true);
    expect(canTransition('auditing', 'expert_review')).toBe(true);
    expect(canTransition('ready_to_publish', 'published')).toBe(true);
    expect(canTransition('expert_review', 'ready_to_publish')).toBe(true);
  });

  it('cannot skip the audit or leave published', () => {
    expect(canTransition('draft', 'published')).toBe(false);
    expect(canTransition('changes_requested', 'published')).toBe(false);
    expect(canTransition('auditing', 'published')).toBe(false);
    expect(canTransition('published', 'draft')).toBe(false);
    expect(canTransition('published', 'changes_requested')).toBe(false);
    expect(versionTransitions.archived).toEqual([]);
  });
});

describe('validateDecision (F4-R6)', () => {
  const all = (v: boolean) => Object.fromEntries(CHECKLIST_ITEMS.map((k) => [k, v]));

  it('approves when every item is ticked', () => {
    const r = validateDecision({ decision: 'approved', items: all(true) });
    expect(r).toMatchObject({ ok: true, decision: 'approved' });
  });

  it('refuses an approval with an unticked item', () => {
    const r = validateDecision({
      decision: 'approved',
      items: { ...all(true), edge_cases: false },
    });
    expect(r.ok).toBe(false);
  });

  it('refuses a rejection without a comment, accepts one with a comment', () => {
    expect(validateDecision({ decision: 'rejected', items: all(false) }).ok).toBe(false);
    expect(
      validateDecision({ decision: 'rejected', items: all(false), comment: 'Замало глибини.' }).ok,
    ).toBe(true);
  });

  it('refuses a checklist with missing items', () => {
    const r = validateDecision({
      decision: 'rejected',
      items: { theory_accuracy: true },
      comment: 'x',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.length).toBe(CHECKLIST_ITEMS.length - 1);
  });
});

describe('audit config', () => {
  const base = { DATABASE_URL: 'postgres://x' };

  it('defaults to 5 runs, 5 samples and the SPEC volume caps', () => {
    const c = loadConfig(base);
    expect(c.audit.maxAttempts).toBe(5);
    expect(c.audit.scoringRuns).toBe(5);
    expect(c.audit.volumeCaps).toEqual(DEFAULT_RATING_CONFIG.volumeCaps);
  });

  it('reads custom caps and rejects malformed ones', () => {
    expect(loadConfig({ ...base, AUDIT_VOLUME_CAPS: '2:3,4:6' }).audit.volumeCaps).toEqual([
      { below: 2, cap: 3 },
      { below: 4, cap: 6 },
    ]);
    for (const bad of ['6', '6:3,4:6', '6:3,12:3', '6:10', 'a:b']) {
      expect(() => loadConfig({ ...base, AUDIT_VOLUME_CAPS: bad })).toThrow(/AUDIT_VOLUME_CAPS/);
    }
  });
});
