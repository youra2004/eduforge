'use client';

import { useRef, useState } from 'react';
import { Icon } from './icons';

/**
 * A live filter for the table with the given id: rows whose text lacks the query are hidden.
 * The table itself stays server-rendered; only the `hidden` flag of its rows changes.
 */
export function TableSearch({
  target,
  placeholder = 'Пошук…',
  label = 'Пошук у таблиці',
}: {
  target: string;
  placeholder?: string;
  label?: string;
}) {
  const [shown, setShown] = useState<number | null>(null);
  const total = useRef(0);

  function filter(query: string) {
    const rows = document.querySelectorAll<HTMLTableRowElement>(`#${target} tbody tr`);
    const q = query.trim().toLowerCase();
    let visible = 0;
    rows.forEach((row) => {
      const match = q === '' || (row.textContent ?? '').toLowerCase().includes(q);
      row.hidden = !match;
      if (match) visible++;
    });
    total.current = rows.length;
    setShown(q === '' ? null : visible);
  }

  return (
    <div className="toolbar">
      <label className="search">
        <span className="sr-only">{label}</span>
        <Icon name="search" size={16} />
        <input
          type="search"
          placeholder={placeholder}
          onChange={(e) => filter(e.target.value)}
          autoComplete="off"
        />
      </label>
      {shown !== null && (
        <span className="count-note" role="status">
          {shown === 0 ? 'Нічого не знайдено' : `Показано ${shown} з ${total.current}`}
        </span>
      )}
    </div>
  );
}
