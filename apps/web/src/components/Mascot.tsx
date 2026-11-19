'use client';

import { useEffect, useId, useRef } from 'react';

export type Mood = 'happy' | 'wow' | 'think' | 'cheer' | 'oops' | 'sleep';

/**
 * Вузлик, the platform's mascot: a round node with two antennae that are nodes themselves (the brand mark grown legs).
 * Decorative only (`aria-hidden`). With `follow` the pupils look at the pointer.
 */
export function Mascot({
  mood = 'happy',
  size = 120,
  float = false,
  follow = false,
  className = '',
}: {
  mood?: Mood;
  size?: number;
  float?: boolean;
  follow?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!follow) return;
    const svg = ref.current;
    if (!svg || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    function onMove(e: PointerEvent) {
      const r = svg!.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 220) * 3.2;
      svg!.style.setProperty('--px', `${(dx / d) * k}px`);
      svg!.style.setProperty('--py', `${(dy / d) * k}px`);
    }
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [follow]);

  const closed = mood === 'sleep';
  const mouth = {
    happy: <path d="M50 82q10 9 20 0" />,
    wow: <ellipse cx="60" cy="85" rx="5" ry="6.5" className="fill" />,
    think: <path d="M52 85h14" />,
    cheer: <path d="M47 80q13 17 26 0z" className="fill" />,
    oops: <path d="M51 88q9-8 18 0" />,
    sleep: <path d="M54 84q6 4 12 0" />,
  }[mood];

  return (
    <svg
      ref={ref}
      className={`mascot ${mood}${float ? ' float' : ''} ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}b`}
          x1="20"
          y1="20"
          x2="100"
          y2="110"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#8f83ff" />
          <stop offset="1" stopColor="#4b3cf0" />
        </linearGradient>
      </defs>
      <ellipse className="m-shadow" cx="60" cy="112" rx="30" ry="5" />
      {/* antennae: two small nodes on thin links, like the brand mark */}
      <g className="m-antennae">
        <path d="M44 28 38 11M76 28l7-18" className="stem" />
        <circle cx="37" cy="9" r="5.5" fill="#ffc531" />
        <circle cx="84" cy="8" r="5.5" fill="#17c58f" />
      </g>
      {mood === 'cheer' && (
        <g className="arms">
          <path d="M18 66 7 44M102 66l11-22" className="stem arm" />
          <circle cx="6" cy="42" r="5" fill="#ffc531" />
          <circle cx="114" cy="42" r="5" fill="#ffc531" />
        </g>
      )}
      <path
        className="m-body"
        d="M60 20C91 20 106 43 106 70c0 27-18 40-46 40S14 97 14 70c0-27 15-50 46-50Z"
        fill={`url(#${uid}b)`}
      />
      <path
        className="m-shine"
        d="M30 48c4-12 14-19 25-21"
        fill="none"
        stroke="#fff"
        strokeOpacity=".45"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <g className="m-feet">
        <ellipse cx="42" cy="109" rx="11" ry="4.5" fill="#3a2cc4" />
        <ellipse cx="78" cy="109" rx="11" ry="4.5" fill="#3a2cc4" />
      </g>
      <circle cx="31" cy="78" r="6.5" fill="#ff5c93" opacity=".55" />
      <circle cx="89" cy="78" r="6.5" fill="#ff5c93" opacity=".55" />
      {closed ? (
        <g className="m-eyes closed">
          <path d="M36 64q8 6 16 0M68 64q8 6 16 0" />
        </g>
      ) : (
        <g className={`m-eyes ${mood === 'oops' ? 'sad' : ''}`}>
          <g className="eye">
            <ellipse cx="44" cy="62" rx="11" ry="13" fill="#fff" />
            <circle className="pupil" cx="45" cy="64" r="6" />
          </g>
          <g className="eye">
            <ellipse cx="76" cy="62" rx="11" ry="13" fill="#fff" />
            <circle className="pupil" cx="77" cy="64" r="6" />
          </g>
        </g>
      )}
      {mood === 'think' && <path className="brow" d="M66 45q9-5 18 0" />}
      {mood === 'oops' && (
        <path className="drop" d="M96 40c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12Z" />
      )}
      {mood === 'sleep' && (
        <g className="zzz">
          <text x="92" y="30">
            z
          </text>
          <text x="102" y="18">
            z
          </text>
        </g>
      )}
      <g className="m-mouth">{mouth}</g>
    </svg>
  );
}
