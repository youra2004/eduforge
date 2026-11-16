import { requirePageRole } from '@/lib/pages';

export default async function Page() {
  await requirePageRole('expert');
  return (
    <div className="card">
      <h1>Експерт</h1>
      <p className="muted">
        Тут експерт розглядатиме курси у черзі на перевірку. (розділ у розробці)
      </p>
    </div>
  );
}
