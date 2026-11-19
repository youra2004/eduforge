'use client';

import { useEffect, useState } from 'react';
import { Icon } from './icons';

interface ToastItem {
  id: number;
  message: string;
  kind: 'ok' | 'error';
  leaving?: boolean;
}

const EVENT = 'eduforge:toast';

/** Shows a short confirmation. Any client code can call it; the Toaster in the layout renders it. */
export function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, kind } }));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    let next = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    function onToast(e: Event) {
      const { message, kind } = (e as CustomEvent<{ message: string; kind: 'ok' | 'error' }>)
        .detail;
      const id = next++;
      setItems((list) => [...list.slice(-2), { id, message, kind }]);
      later(
        () => setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))),
        3600,
      );
      later(() => setItems((list) => list.filter((t) => t.id !== id)), 3900);
    }
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="toaster" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind === 'error' ? 'error' : ''} ${t.leaving ? 'leaving' : ''}`}
        >
          <span className="ico">
            <Icon name={t.kind === 'error' ? 'alert' : 'check'} size={14} />
          </span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
