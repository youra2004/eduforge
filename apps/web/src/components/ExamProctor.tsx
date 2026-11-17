'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sendJson } from '@/lib/client';
import {
  KeystrokeRecorder,
  MIN_BRIGHTNESS,
  FaceSignals,
  brightness,
  captureFrame,
  createMediaPipeMonitor,
  createScriptedMonitor,
  devtoolsLikelyOpen,
  isDesktop,
  nextSnapshot,
  type FaceMonitor,
} from '@/lib/proctor';

export interface ProctorView {
  enabled: boolean;
  ready: boolean;
  mock: boolean;
  snapshotIntervalSeconds: number;
  focusGraceSeconds: number;
}

type Report = { type: string; payload?: Record<string, unknown> };

/**
 * The browser side of the exam's integrity checks (F9). Before the first question: desktop, camera, light, a reference
 * photo, fullscreen. During the exam: leaving fullscreen, losing focus, copy/paste and devtools, MediaPipe looking for
 * faces, a frame at a random moment each interval, the typing rhythm. It reports; the server decides what it means.
 * Nothing is recorded: the video stays in this page and a frame is sent only for the check.
 */
export function ExamProctor({
  examId,
  proctor,
  running,
  onActive,
  onChanged,
  onCameraLost,
}: {
  examId: string;
  proctor: ProctorView;
  running: boolean;
  /** The gate is passed in this page: the questions may be shown. */
  onActive: (active: boolean) => void;
  /** The server may have stopped the attempt or let the question through: ask it again. */
  onChanged: () => void;
  onCameraLost: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const referenceRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [desktop, setDesktop] = useState(true);
  // Demo mode only: `?proctor=phone` and so on picks the scenario the mock checker plays.
  const [scenario] = useState(() =>
    proctor.mock && typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('proctor') ?? 'normal')
      : 'normal',
  );

  useEffect(() => {
    setDesktop(isDesktop(window));
  }, []);
  useEffect(() => onActive(active), [active, onActive]);

  const report = useCallback(
    async (events: Report[]) => {
      const res = await sendJson<{ accepted: boolean }>(
        `/api/exams/${examId}/proctor/events`,
        'POST',
        { events },
      );
      return res.ok;
    },
    [examId],
  );

  /** A hard event stops the attempt on the server; the runner then shows what happened. */
  const reportHard = useCallback(
    async (event: Report) => {
      await report([event]);
      onChanged();
    },
    [report, onChanged],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    referenceRef.current = null;
  }, []);

  // The gate: camera, light, reference photo, fullscreen. Needs a click (browsers allow fullscreen only then).
  async function begin() {
    setBusy(true);
    setError(null);
    try {
      if (!isDesktop(window)) throw new Error('desktop');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      // Give the camera a moment to settle its exposure.
      await new Promise((r) => setTimeout(r, 700));
      if (brightness(video) < MIN_BRIGHTNESS) throw new Error('dark');
      if (!proctor.mock || scenario === 'mediapipe') {
        const monitor = await createMediaPipeMonitor();
        const look = await monitor.look(video);
        monitor.close();
        if (look.faces !== 1) throw new Error(look.faces === 0 ? 'no_face' : 'many_faces');
      }
      referenceRef.current = captureFrame(video);
      await document.documentElement.requestFullscreen();
      if (!(await report([{ type: 'fullscreen_enter' }, { type: 'camera_ready' }]))) {
        throw new Error('report');
      }
      setActive(true);
      onChanged();
    } catch (err) {
      stopCamera();
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      const code = err instanceof Error ? err.message : '';
      setError(
        {
          desktop: 'Іспит проходять на комп’ютері з широким екраном. Відкрийте сторінку на ньому.',
          dark: 'Замало світла: обличчя має бути добре освітлене. Додайте світла й спробуйте ще раз.',
          no_face: 'Камера не бачить обличчя. Сядьте перед камерою так, щоб обличчя було в кадрі.',
          many_faces: 'У кадрі більше однієї людини. На іспиті ви маєте бути сам(а).',
          report: 'Не вдалося повідомити серверу. Спробуйте ще раз.',
        }[code] ??
          'Не вдалося увімкнути камеру або повноекранний режим. Дозвольте доступ до камери й спробуйте ще раз.',
      );
    }
    setBusy(false);
  }

  // After a reload the server still has the camera as ready, but this page has neither the stream nor the photo.
  // The gate asks again (and the server notes a second reference photo as a soft signal).
  const needsGate = !proctor.ready || (running && !active);

  // Hard events: fullscreen, focus, copy/paste, devtools (F9-R2).
  useEffect(() => {
    if (!active || !running) return;
    let awayTimer: ReturnType<typeof setTimeout> | null = null;
    let awaySince = 0;
    const onFullscreen = () => {
      if (!document.fullscreenElement) void reportHard({ type: 'fullscreen_exit' });
    };
    const away = () => {
      if (awayTimer) return;
      awaySince = Date.now();
      awayTimer = setTimeout(() => {
        awayTimer = null;
        void reportHard({ type: 'focus_lost', payload: { awayMs: Date.now() - awaySince } });
      }, proctor.focusGraceSeconds * 1000);
    };
    const back = () => {
      if (awayTimer) clearTimeout(awayTimer);
      awayTimer = null;
    };
    const onVisibility = () => (document.hidden ? away() : back());
    const clip = (type: 'copy' | 'paste') => (e: Event) => {
      e.preventDefault();
      void reportHard({ type });
    };
    const onCopy = clip('copy');
    const onPaste = clip('paste');
    const onKeys = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const devtoolsKey =
        e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && 'ijc'.includes(k));
      if (devtoolsKey) {
        e.preventDefault();
        void reportHard({ type: 'devtools_open' });
      }
    };
    const poll = setInterval(() => {
      if (devtoolsLikelyOpen(window)) void reportHard({ type: 'devtools_open' });
    }, 1000);
    document.addEventListener('fullscreenchange', onFullscreen);
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKeys);
    return () => {
      if (awayTimer) clearTimeout(awayTimer);
      clearInterval(poll);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('blur', away);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('keydown', onKeys);
    };
  }, [active, running, proctor.focusGraceSeconds, reportHard]);

  // The camera itself: if it stops, that is a technical interruption, not a violation (D-20).
  useEffect(() => {
    if (!active || !running) return;
    const tracks = streamRef.current?.getVideoTracks() ?? [];
    const lost = () => {
      stopCamera();
      setActive(false);
      onCameraLost();
    };
    tracks.forEach((t) => t.addEventListener('ended', lost));
    return () => tracks.forEach((t) => t.removeEventListener('ended', lost));
  }, [active, running, onCameraLost, stopCamera]);

  // MediaPipe, every 2-3 s, in the page only (F9-R4). Signals are reported once they repeat.
  useEffect(() => {
    if (!active || !running) return;
    let stopped = false;
    let monitor: FaceMonitor | null = null;
    const signals = new FaceSignals();
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stopped) return;
      try {
        const video = videoRef.current;
        if (video && monitor && video.readyState >= 2) {
          const out = signals.push(await monitor.look(video));
          if (out.length) await report(out.map((type) => ({ type })));
        }
      } catch (err) {
        console.error('[proctor] face check failed', err);
      }
      timer = setTimeout(loop, 2000 + Math.random() * 1000);
    };
    (async () => {
      try {
        monitor =
          proctor.mock && scenario !== 'mediapipe'
            ? createScriptedMonitor(scenario)
            : await createMediaPipeMonitor();
      } catch (err) {
        // No detector (offline CDN, say): the server-side frame check still runs.
        console.error('[proctor] MediaPipe unavailable', err);
        return;
      }
      if (!stopped) void loop();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      monitor?.close();
    };
  }, [active, running, proctor.mock, scenario, report]);

  // One frame per window at a random moment (F9-R4, D-21). The server also limits the pace.
  useEffect(() => {
    if (!active || !running) return;
    const intervalMs = proctor.snapshotIntervalSeconds * 1000;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let offset: number | null = null;
    const schedule = () => {
      const next = nextSnapshot(offset, intervalMs);
      offset = next.offset;
      timer = setTimeout(async () => {
        const video = videoRef.current;
        if (!stopped && video && referenceRef.current && video.readyState >= 2) {
          await sendJson(`/api/exams/${examId}/proctor/snapshot`, 'POST', {
            frame: captureFrame(video),
            reference: referenceRef.current,
            scenario: proctor.mock ? scenario : undefined,
          });
        }
        if (!stopped) schedule();
      }, next.delay);
    };
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, running, examId, proctor.snapshotIntervalSeconds, proctor.mock, scenario]);

  // Typing rhythm (F9-R5, D-24): gaps between keys of an answer, sent when the answer is submitted.
  useEffect(() => {
    if (!active || !running) return;
    const rec = new KeystrokeRecorder();
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) rec.key(e);
    };
    const flush = (e: Event) => {
      const area = (e.target as HTMLElement).querySelector('textarea');
      if (area) void report([{ type: 'keystroke', payload: rec.take(area.value.length) }]);
      else rec.take(0);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('submit', flush, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('submit', flush, true);
    };
  }, [active, running, report]);

  // When the exam is over (or the page is left), let go of the camera and the fullscreen. This effect is declared after
  // the listeners', so theirs are already removed when the fullscreen change fires.
  useEffect(() => {
    if (running) return;
    stopCamera();
    setActive(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [running, stopCamera]);
  useEffect(
    () => () => {
      stopCamera();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    },
    [stopCamera],
  );

  return (
    <>
      <video
        ref={videoRef}
        muted
        playsInline
        data-testid="proctor-video"
        className={
          needsGate ? 'proctor-preview gate' : active ? 'proctor-preview live' : 'proctor-preview'
        }
        hidden={!needsGate && !active}
      />
      {active && running && (
        <p className="proctor-badge" data-testid="proctor-active">
          <span className="dot" aria-hidden /> Перевірка активна
        </p>
      )}
      {needsGate && running && (
        <div className="card proctor-gate" data-testid="proctor-gate">
          <h2>Перевірка перед початком</h2>
          <p>
            Іспит проходить під наглядом камери. Це стримування й докази, а не гарантія: система
            фіксує підозрілі події, а рішення про порушення ухвалює сервер і, у спірних випадках,
            адміністратор.
          </p>
          <ul>
            <li>Камера й освітлення: обличчя має бути добре видно, у кадрі — лише ви.</li>
            <li>
              Повноекранний режим: вихід із нього, втрата фокуса понад {proctor.focusGraceSeconds}{' '}
              с, копіювання/вставлення та інструменти розробника зупиняють спробу й дають порушення.
            </li>
            <li>
              Відео нікуди не передається й не записується. Раз на хвилину в довільний момент кадр
              надсилається на перевірку й одразу видаляється; зберігається лише кадр, що спричинив
              подію (30 днів, зашифрований).
            </li>
            <li>Технічна проблема (камера, мережа) — це перерва без штрафу.</li>
          </ul>
          {!desktop && (
            <p className="error" role="alert" data-testid="proctor-desktop">
              Іспит проходять на комп’ютері з широким екраном. Відкрийте сторінку на ньому.
            </p>
          )}
          <button
            type="button"
            onClick={begin}
            disabled={busy || !desktop}
            data-testid="proctor-begin"
          >
            Увімкнути камеру й повноекранний режим
          </button>
          {error && (
            <p className="error" role="alert" data-testid="proctor-error">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
