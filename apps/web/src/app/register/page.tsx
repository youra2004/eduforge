import Link from 'next/link';
import { CONSENT_VERSIONS } from '@eduforge/core';
import { AuthForm } from '@/components/AuthForm';
import { ConsentCheckbox } from '@/components/ConsentCheckbox';

export default function RegisterPage() {
  return (
    <div className="card narrow">
      <h1>Реєстрація</h1>
      <AuthForm endpoint="/api/auth/register" submitLabel="Зареєструватися" showName>
        <ConsentCheckbox name="acceptTerms" version={CONSENT_VERSIONS.terms} required>
          Погоджуюсь з умовами користування платформою
        </ConsentCheckbox>
        <ConsentCheckbox name="acceptResearch" version={CONSENT_VERSIONS.research}>
          Погоджуюсь на використання знеособлених даних навчання в дослідженні (необовʼязково)
        </ConsentCheckbox>
      </AuthForm>
      <p className="hint">
        Вже є акаунт? <Link href="/login">Увійти</Link>
      </p>
    </div>
  );
}
