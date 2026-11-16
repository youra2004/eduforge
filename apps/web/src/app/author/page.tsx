import { requirePageRole } from '@/lib/pages';

export default async function Page() {
  await requirePageRole('author');
  return (
    <div className="card">
      <h1>Автор</h1>
      <p className="muted">
        Тут автор створюватиме курси, графи знань і питання. (розділ у розробці)
      </p>
    </div>
  );
}
