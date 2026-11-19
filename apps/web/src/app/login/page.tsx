import Link from 'next/link';
import { AuthForm } from '@/components/AuthForm';

export const metadata = { title: 'Вхід' };

export default function LoginPage() {
  return (
    <div className="auth">
      <div className="card auth-card">
        <h1>Вхід</h1>
        <p className="lead">Продовжте навчання з того місця, де зупинились.</p>
        <AuthForm endpoint="/api/auth/login" submitLabel="Увійти" />
        <p className="hint">
          Немає акаунта? <Link href="/register">Зареєструватися</Link>
        </p>
      </div>
    </div>
  );
}
