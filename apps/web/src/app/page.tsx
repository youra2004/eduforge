import { getCurrentUser } from '@/lib/server';

export default async function Home() {
  const user = await getCurrentUser();
  return (
    <div className="card">
      <h1>EduForge</h1>
      <p>Платформа навчання на основі графа знань.</p>
      {user ? (
        <p>
          Вітаємо, {user.displayName}! Оберіть розділ у меню вище.
          {user.roles.length === 0 &&
            ' Вам ще не призначено жодної ролі — зверніться до адміністратора.'}
        </p>
      ) : (
        <p className="muted">Увійдіть або зареєструйтесь, щоб почати.</p>
      )}
    </div>
  );
}
