import { describe, expect, it } from 'vitest';
import { FaceSignals, KeystrokeRecorder, nextSnapshot } from './proctor';

describe('snapshot scheduler (F9-R4, D-21)', () => {
  it('shoots once per window at a random moment inside it', () => {
    const interval = 60_000;
    let offset: number | null = null;
    let t = 0;
    const times: number[] = [];
    const rand = (() => {
      const seq = [0.5, 0.1, 0.9, 0.3];
      let i = 0;
      return () => seq[i++ % seq.length]!;
    })();
    for (let k = 0; k < 4; k++) {
      const next = nextSnapshot(offset, interval, rand);
      t += next.delay;
      offset = next.offset;
      times.push(t);
    }
    // One shot in each 60 s window, at different moments.
    times.forEach((time, k) => {
      expect(Math.floor(time / interval)).toBe(k);
    });
    expect(new Set(times.map((x) => x % interval)).size).toBe(4);
  });

  it('never waits longer than two windows or less than nothing', () => {
    for (let i = 0; i < 200; i++) {
      const { delay } = nextSnapshot(Math.floor(Math.random() * 60_000), 60_000);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(120_000);
    }
  });
});

describe('face signals', () => {
  it('reports a condition only after three looks in a row, then keeps quiet', () => {
    const s = new FaceSignals(30_000);
    expect(s.push({ faces: 0, turn: 0 }, 0)).toEqual([]);
    expect(s.push({ faces: 0, turn: 0 }, 2500)).toEqual([]);
    expect(s.push({ faces: 0, turn: 0 }, 5000)).toEqual(['face_missing']);
    expect(s.push({ faces: 0, turn: 0 }, 7500)).toEqual([]);
    expect(s.push({ faces: 0, turn: 0 }, 40_000)).toEqual(['face_missing']);
  });

  it('a single good look resets the streak', () => {
    const s = new FaceSignals();
    s.push({ faces: 2, turn: 0 }, 0);
    s.push({ faces: 2, turn: 0 }, 1);
    s.push({ faces: 1, turn: 0 }, 2);
    expect(s.push({ faces: 2, turn: 0 }, 3)).toEqual([]);
  });

  it('tells a second face and a turned head apart', () => {
    const s = new FaceSignals();
    for (let i = 0; i < 2; i++) s.push({ faces: 1, turn: 0.9 }, i);
    expect(s.push({ faces: 1, turn: 0.9 }, 3)).toEqual(['head_turn']);
    const t = new FaceSignals();
    for (let i = 0; i < 2; i++) t.push({ faces: 2, turn: 0.9 }, i);
    expect(t.push({ faces: 2, turn: 0.9 }, 3)).toEqual(['multiple_faces']);
  });
});

describe('keystroke recorder (D-24)', () => {
  it('ignores auto-repeat and counts only text typed since the first key (a restored draft is not a paste)', () => {
    const r = new KeystrokeRecorder();
    r.startChars = 40; // the draft that came back after a reload
    const key = { key: 'a', ctrlKey: false, metaKey: false, altKey: false };
    r.key(key, 0);
    r.key({ ...key, repeat: true }, 30);
    r.key(key, 150);
    expect(r.take(42)).toEqual({ intervalsMs: [150], corrections: 0, chars: 2, keys: 2 });
  });

  it('keeps intervals and counts, not characters', () => {
    const r = new KeystrokeRecorder();
    r.key({ key: 'a', ctrlKey: false, metaKey: false, altKey: false }, 0);
    r.key({ key: 'b', ctrlKey: false, metaKey: false, altKey: false }, 120);
    r.key({ key: 'Backspace', ctrlKey: false, metaKey: false, altKey: false }, 300);
    r.key({ key: 'Shift', ctrlKey: false, metaKey: false, altKey: false }, 320);
    r.key({ key: 'v', ctrlKey: true, metaKey: false, altKey: false }, 400);
    const s = r.take(1);
    expect(s).toEqual({ intervalsMs: [120, 180], corrections: 1, chars: 1, keys: 2 });
    expect(JSON.stringify(s)).not.toMatch(/"a"|"b"/);
    expect(r.take(0).intervalsMs).toEqual([]);
  });
});
