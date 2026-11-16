import Link from 'next/link';
import { AuthForm } from '@/components/AuthForm';

export default function LoginPage() {
  return (
    <div className="card narrow">
      <h1>Вхід</h1>
      <AuthForm endpoint="/api/auth/login" submitLabel="Увійти" />
      <p className="hint">
        Немає акаунта? <Link href="/register">Зареєструватися</Link>
      </p>
    </div>
  );
}
