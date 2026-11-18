import { listCertificates } from '@eduforge/core';
import Link from 'next/link';
import { RevokeCertificate } from '@/components/RevokeCertificate';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function CertificatesPage() {
  const admin = await requirePageRole('admin');
  const list = await listCertificates(getDb(), admin);
  return (
    <div className="card wide">
      <p>
        <Link href="/admin">← До адміністрування</Link>
      </p>
      <h1>Сертифікати</h1>
      <p className="hint">
        Відкликаний сертифікат на публічній сторінці показується як недійсний; причину бачите лише
        ви. Сертифікат також відкликається автоматично, коли підтверджене порушення скасовує
        складений іспит.
      </p>
      {list.length === 0 ? (
        <p className="muted" data-testid="no-certificates">
          Сертифікатів ще немає.
        </p>
      ) : (
        <table data-testid="certificates">
          <thead>
            <tr>
              <th>Власник</th>
              <th>Курс</th>
              <th>Видано</th>
              <th>Стан</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} data-testid="certificate-row">
                <td>
                  {c.holderName} <span className="muted">{c.holderEmail}</span>
                </td>
                <td>
                  {c.title} <span className="muted">v{c.version}</span> · {c.scorePct} %
                </td>
                <td>
                  <Link href={`/verify/${c.id}`}>{c.issuedAt.toLocaleDateString('uk-UA')}</Link>
                </td>
                <td>
                  {c.revokedAt ? (
                    <span data-testid="certificate-state">
                      Відкликано {c.revokedAt.toLocaleDateString('uk-UA')}: {c.revokeReason}
                    </span>
                  ) : (
                    <>
                      <span data-testid="certificate-state">Дійсний</span>
                      <RevokeCertificate certificateId={c.id} />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
