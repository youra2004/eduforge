'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';

export interface PaletteLink {
  label: string;
  href: string;
  hint?: string;
}

interface CourseItem {
  versionId: string;
  title: string;
  versionNo: number;
}

/** Ctrl/⌘ K: jump to any page of the user's roles or to a course by name. Courses are fetched when it is first opened. */
export function CommandPalette({ links }: { links: PaletteLink[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [courses, setCourses] = useState<PaletteLink[] | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        opener.current = document.activeElement as HTMLElement | null;
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open || courses) return;
    let cancelled = false;
    fetch('/api/courses')
      .then((r) => (r.ok ? r.json() : { versions: [] }))
      .then((data: { versions: CourseItem[] }) => {
        if (cancelled) return;
        setCourses(
          data.versions.map((v) => ({
            label: `${v.title} v${v.versionNo}`,
            href: `/courses/${v.versionId}`,
            hint: 'Курс',
          })),
        );
      })
      .catch(() => !cancelled && setCourses([]));
    return () => {
      cancelled = true;
    };
  }, [open, courses]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (l: PaletteLink) => q === '' || l.label.toLowerCase().includes(q);
    return {
      pages: links.filter(match),
      courses: (courses ?? []).filter(match).slice(0, 8),
    };
  }, [query, links, courses]);
  const flat = [...results.pages, ...results.courses];

  function close() {
    setOpen(false);
    opener.current?.focus();
    setQuery('');
    setActive(0);
  }
  function go(link: PaletteLink) {
    close();
    router.push(link.href);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // the search box is the only stop: focus stays inside the dialog
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      const next = (active + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length;
      setActive(next);
      listRef.current?.querySelector(`[data-i="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      go(flat[active]);
    }
  }

  const item = (l: PaletteLink, i: number) => (
    <li
      key={l.href + l.label}
      role="option"
      aria-selected={i === active}
      data-i={i}
      onMouseMove={() => setActive(i)}
      onClick={() => go(l)}
    >
      <Icon name={l.hint === 'Курс' ? 'book' : 'arrow-right'} size={15} />
      {l.label}
      {l.hint && <span className="hint">{l.hint}</span>}
    </li>
  );

  return (
    <>
      <button
        type="button"
        className="secondary sm palette-trigger"
        onClick={(e) => {
          opener.current = e.currentTarget;
          setOpen(true);
        }}
        aria-label="Швидкий перехід"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Icon name="search" size={15} />
        <span className="label">Швидкий перехід</span>
        <kbd>⌘K</kbd>
      </button>
      {open && (
        <div
          className="palette-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Швидкий перехід"
            onKeyDown={onKeyDown}
          >
            <div className="palette-input">
              <Icon name="search" size={18} />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Куди перейти? Сторінка або курс"
                aria-label="Пошук сторінки або курсу"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                autoComplete="off"
              />
            </div>
            <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
              {results.pages.length > 0 && (
                <li className="palette-group" role="presentation">
                  Сторінки
                </li>
              )}
              {results.pages.map((l, i) => item(l, i))}
              {results.courses.length > 0 && (
                <li className="palette-group" role="presentation">
                  Курси
                </li>
              )}
              {results.courses.map((l, i) => item(l, results.pages.length + i))}
              {flat.length === 0 && (
                <li role="presentation" style={{ cursor: 'default', color: 'var(--muted)' }}>
                  {courses === null ? 'Завантаження…' : 'Нічого не знайдено'}
                </li>
              )}
            </ul>
            <div className="palette-foot">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> вибір
              </span>
              <span>
                <kbd>↵</kbd> відкрити
              </span>
              <span>
                <kbd>Esc</kbd> закрити
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
