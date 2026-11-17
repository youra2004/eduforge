/**
 * Browser side of the proctoring (F9). It only looks and reports: what each report means, and what follows from
 * it, is decided by the server (P1). Nothing here keeps a frame: the video stays in the page.
 */

/** A frame of the video as a base64 JPEG without the data-URL prefix. */
export function captureFrame(video: HTMLVideoElement, maxWidth = 640): string {
  const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((video.videoWidth || maxWidth) * scale));
  canvas.height = Math.max(1, Math.round((video.videoHeight || 480) * scale));
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7).split(',')[1]!;
}

/** Average brightness 0-255 of a frame's pixels; the pre-check asks for enough light to see a face. */
export function brightness(video: HTMLVideoElement): number {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 24;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, 32, 24);
  const { data } = ctx.getImageData(0, 0, 32, 24);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  }
  return sum / (data.length / 4);
}

export const MIN_BRIGHTNESS = 45;

/**
 * F9-R4: one frame per window of `intervalMs`, at a random moment inside it (the jitter), so the moment cannot be
 * predicted. Returns how long to wait from the previous shot and where in its window the next one falls.
 */
export function nextSnapshot(
  previousOffsetMs: number | null,
  intervalMs: number,
  rand: () => number = Math.random,
) {
  const offset = Math.floor(rand() * intervalMs);
  const delay = previousOffsetMs === null ? offset : intervalMs - previousOffsetMs + offset;
  return { delay, offset };
}

/** Desktop only (D-22): a wide screen with a mouse. A phone or tablet cannot sit the exam. */
export function isDesktop(win: Pick<Window, 'innerWidth' | 'matchMedia'>): boolean {
  return win.innerWidth >= 900 && !win.matchMedia('(pointer: coarse)').matches;
}

/** Docked devtools shrink the page next to the window, but so does page zoom: a guess, reported as a soft signal only. */
export function devtoolsLikelyOpen(
  win: Pick<Window, 'outerWidth' | 'innerWidth' | 'outerHeight' | 'innerHeight'>,
) {
  return win.outerWidth - win.innerWidth > 200 || win.outerHeight - win.innerHeight > 260;
}

/** Collects the gaps between key presses of one answer, never the characters (D-24). */
export class KeystrokeRecorder {
  private last: number | null = null;
  private intervals: number[] = [];
  private corrections = 0;
  private keys = 0;
  /** Length of the text before the first key of this answer, so a draft restored after a reload is not a paste. */
  startChars: number | null = null;

  key(
    e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'> & { repeat?: boolean },
    now = performance.now(),
  ) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace' || e.key === 'Delete') this.corrections++;
    else if (e.key.length === 1) this.keys++;
    else return;
    if (this.last !== null) this.intervals.push(Math.round(now - this.last));
    this.last = now;
  }

  /** The summary so far; `chars` is the length of the text now. Resets for the next answer. */
  take(chars: number) {
    const out = {
      intervalsMs: this.intervals.slice(0, 5000),
      corrections: this.corrections,
      chars: Math.max(0, chars - (this.startChars ?? 0)),
      keys: this.keys,
    };
    this.startChars = null;
    this.last = null;
    this.intervals = [];
    this.corrections = 0;
    this.keys = 0;
    return out;
  }
}

// ---------------------------------------------------------------- the face monitor (MediaPipe, ~every 2-3 s)

export interface FaceLook {
  faces: number;
  /** How far the head is turned, 0 = facing the screen (nose offset from the eyes' midpoint, in eye distances). */
  turn: number;
}

export interface FaceMonitor {
  look(video: HTMLVideoElement): Promise<FaceLook>;
  close(): void;
}

const MEDIAPIPE_VERSION = '0.10.21';
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

/** MediaPipe's face detector runs in the page; the video never leaves it. */
export async function createMediaPipeMonitor(): Promise<FaceMonitor> {
  const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(WASM);
  const detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
    runningMode: 'VIDEO',
  });
  return {
    async look(video) {
      const { detections } = detector.detectForVideo(video, performance.now());
      const k = detections[0]?.keypoints;
      // Keypoints: 0 right eye, 1 left eye, 2 nose tip.
      let turn = 0;
      if (k && k.length >= 3) {
        const eyes = Math.abs(k[1]!.x - k[0]!.x) || 1;
        turn = Math.abs(k[2]!.x - (k[0]!.x + k[1]!.x) / 2) / eyes;
      }
      return { faces: detections.length, turn };
    },
    close: () => detector.close(),
  };
}

/** Demo mode: a scripted monitor, so the scenarios can be played with a fake camera. */
export function createScriptedMonitor(scenario: string): FaceMonitor {
  return {
    async look() {
      if (scenario === 'no_face') return { faces: 0, turn: 0 };
      if (scenario === 'second_person') return { faces: 2, turn: 0 };
      if (scenario === 'gaze_away') return { faces: 1, turn: 1 };
      return { faces: 1, turn: 0 };
    },
    close() {},
  };
}

export const HEAD_TURN_LIMIT = 0.45;
/** A look must repeat this many checks in a row before it is reported, so one blink of the detector is not a signal. */
export const CONSECUTIVE_LOOKS = 3;

/** Turns a stream of looks into reports: a condition seen CONSECUTIVE_LOOKS times in a row, then quiet for a while. */
export class FaceSignals {
  private streak = { face_missing: 0, multiple_faces: 0, head_turn: 0 };
  private quietUntil = { face_missing: 0, multiple_faces: 0, head_turn: 0 };

  constructor(private readonly quietMs = 30_000) {}

  push(look: FaceLook, now = Date.now()) {
    const seen = {
      face_missing: look.faces === 0,
      multiple_faces: look.faces > 1,
      head_turn: look.faces === 1 && look.turn > HEAD_TURN_LIMIT,
    };
    const out: (keyof typeof seen)[] = [];
    for (const type of Object.keys(seen) as (keyof typeof seen)[]) {
      this.streak[type] = seen[type] ? this.streak[type] + 1 : 0;
      if (this.streak[type] >= CONSECUTIVE_LOOKS && now >= this.quietUntil[type]) {
        out.push(type);
        this.quietUntil[type] = now + this.quietMs;
      }
    }
    return out;
  }
}
