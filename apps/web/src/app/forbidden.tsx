import Link from 'next/link';
import { Icon } from '@/components/icons';

export default function Forbidden() {
  return (
    <div className="status-page">
      <span className="empty-icon">
        <Icon name="lock" size={20} />
      </span>
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
