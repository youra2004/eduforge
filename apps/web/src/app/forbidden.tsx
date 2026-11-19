import Link from 'next/link';
import { Mascot } from '@/components/Mascot';

export default function Forbidden() {
  return (
    <div className="status-page">
      <Mascot mood="oops" size={120} float />
      <h1>Доступ заборонено</h1>
      <p>
        У вас немає прав для перегляду цієї сторінки. Якщо вам потрібен доступ, зверніться до
        адміністратора.
      </p>
      <div className="actions">
        <Link href="/" className="btn secondary">
          На головну
        </Link>
      </div>
    </div>
  );
}
