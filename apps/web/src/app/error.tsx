'use client';

import { Mascot } from '@/components/Mascot';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="status-page" role="alert">
      <Mascot mood="oops" size={120} float />
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
