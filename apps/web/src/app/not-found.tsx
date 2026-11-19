import Link from 'next/link';
import { Mascot } from '@/components/Mascot';

export default function NotFound() {
  return (
    <div className="status-page">
      <Mascot mood="think" size={120} float />
      <span className="code">404</span>
      <h1>Сторінку не знайдено</h1>
      <p>Можливо, посилання застаріло або сторінку було видалено.</p>
      <div className="actions">
        <Link href="/" className="btn secondary">
          На головну
        </Link>
        <Link href="/courses" className="btn">
          До курсів
        </Link>
      </div>
    </div>
  );
}
