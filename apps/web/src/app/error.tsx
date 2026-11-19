'use client';

import { Icon } from '@/components/icons';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="status-page" role="alert">
      <span className="empty-icon">
        <Icon name="alert" size={20} />
      </span>
      <h1>Щось пішло не так</h1>
      <p>
        Не вдалося показати цю сторінку. Спробуйте ще раз; якщо помилка повторюється, поверніться
        пізніше.
      </p>
      <div className="actions">
        <button type="button" onClick={reset}>
          Спробувати ще раз
        </button>
      </div>
    </div>
  );
}
