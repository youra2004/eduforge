import { z } from 'zod';
import type { Config } from '../config';

/**
 * F9-R4 / D-23: the server-side frame check. A dedicated service compares the face with the reference photo and
 * a Vision model looks for a phone, a second person and gaze away. Frames are bytes in memory only: they are
 * never written here.
 */
export interface ProctorProvider {
  readonly name: string;
  compareFace(
    reference: Buffer,
    frame: Buffer,
    hint?: string,
  ): Promise<{ match: boolean; score: number }>;
  visionCheck(
    frame: Buffer,
    hint?: string,
  ): Promise<{ phone: boolean; secondPerson: boolean; gazeAway: boolean }>;
}

export const MOCK_SCENARIOS = [
  'normal',
  'other_face',
  'second_person',
  'phone',
  'gaze_away',
] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

/**
 * Deterministic provider for tests and demo mode. The scenario comes from `hint`, which the browser sends in
 * demo mode only; the real provider ignores it, so a student cannot pick their own verdict.
 */
export class MockProctorProvider implements ProctorProvider {
  readonly name = 'mock-proctor-1';
  readonly calls: { method: 'compareFace' | 'visionCheck'; hint?: string }[] = [];

  private scenario(hint?: string): MockScenario {
    return (MOCK_SCENARIOS as readonly string[]).includes(hint ?? '')
      ? (hint as MockScenario)
      : 'normal';
  }

  async compareFace(_reference: Buffer, _frame: Buffer, hint?: string) {
    this.calls.push({ method: 'compareFace', hint });
    const match = this.scenario(hint) !== 'other_face';
    return { match, score: match ? 0.93 : 0.21 };
  }

  async visionCheck(_frame: Buffer, hint?: string) {
    this.calls.push({ method: 'visionCheck', hint });
    const s = this.scenario(hint);
    return {
      phone: s === 'phone',
      secondPerson: s === 'second_person',
      gazeAway: s === 'gaze_away',
    };
  }
}

const comparison = z.object({ match: z.boolean(), score: z.number() });
const vision = z.object({ phone: z.boolean(), secondPerson: z.boolean(), gazeAway: z.boolean() });

/** The real adapter: talks to the face-comparison and Vision service at `PROCTOR_SERVICE_URL` (`POST /compare`, `POST /vision`, JSON with base64 frames). */
export class HttpProctorProvider implements ProctorProvider {
  readonly name = 'http-proctor';
  constructor(private readonly baseUrl: string) {}

  private async post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`proctor service ${path} answered ${res.status}`);
    return schema.parse(await res.json());
  }

  compareFace(reference: Buffer, frame: Buffer) {
    return this.post(
      '/compare',
      { reference: reference.toString('base64'), frame: frame.toString('base64') },
      comparison,
    );
  }

  visionCheck(frame: Buffer) {
    return this.post('/vision', { frame: frame.toString('base64') }, vision);
  }
}

export function createProctorProvider(config: Config): ProctorProvider {
  return config.proctoring.provider === 'real'
    ? new HttpProctorProvider(config.proctoring.serviceUrl!)
    : new MockProctorProvider();
}
