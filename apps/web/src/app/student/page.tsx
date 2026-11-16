import { requirePageRole } from '@/lib/pages';

export default async function Page() {
  await requirePageRole('student');
  return (
    <div className="card">
      <h1>Студент</h1>
      <p className="muted">
        Тут буде ваше навчання: курси, тести вузлів та іспит. (розділ у розробці)
      </p>
    </div>
  );
}
