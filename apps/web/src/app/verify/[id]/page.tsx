import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getPublicCertificate } from '@eduforge/core';
import QRCode from 'qrcode';
import { PrintButton } from '@/components/PrintButton';
import { examSkillLevelLabels } from '@/lib/messages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Перевірка сертифіката — EduForge' };

/** F10-R3: the page the QR code points to. Public (D-03): no account, and the signature is checked on every visit. */
export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cert = await getPublicCertificate(getDb(), id);
  if (!cert) notFound();
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const qr = await QRCode.toString(`${proto}://${host}/verify/${cert.id}`, {
    type: 'svg',
    margin: 1,
    width: 160,
  });
  const p = cert.payload;
  const valid = cert.signatureValid && cert.status === 'valid';
  const verdict = !cert.signatureValid
    ? 'Підпис не збігається: дані сертифіката могли бути змінені'
    : cert.status === 'revoked'
      ? 'Сертифікат відкликано'
      : 'Сертифікат дійсний';
  return (
    <div className="card certificate" data-testid="certificate">
      <div className={valid ? 'verdict ok' : 'verdict bad'} role="status" data-testid="verdict">
        <strong data-testid="certificate-status">{verdict}</strong>
        {cert.status === 'revoked' && cert.revokedAt && (
          <span> · {cert.revokedAt.toLocaleDateString('uk-UA')}</span>
        )}
      </div>
      <h1>Сертифікат про завершення курсу</h1>
      <p className="holder" data-testid="holder">
        {p.holder_name}
      </p>
      <p>
        Курс «<strong data-testid="course-title">{p.course.title}</strong>», версія{' '}
        {p.course.version}
        {p.rating !== null && <> · рейтинг складності {p.rating} з 10</>}
      </p>
      <p>
        Результат іспиту: <strong data-testid="score">{p.score_pct} %</strong> · видано{' '}
        {new Date(p.issued_at).toLocaleDateString('uk-UA')}
      </p>
      <h2>Результат за навичками</h2>
      <ul className="skills" data-testid="skills">
        {p.skills.map((s) => (
          <li key={s.name} data-testid="skill">
            <span>
              {s.name} <span className={`level ${s.level}`}>{examSkillLevelLabels[s.level]}</span>
            </span>
            <span className="bar" aria-hidden>
              <span className="fill ok" style={{ width: `${Math.round(s.pct)}%` }} />
            </span>
            <strong>{s.pct} %</strong>
          </li>
        ))}
      </ul>
      <p data-testid="summary">{p.summary_text}</p>
      <div className="cert-foot">
        <img
          src={`data:image/svg+xml;base64,${Buffer.from(qr).toString('base64')}`}
          alt="QR-код цієї сторінки перевірки"
          width={120}
          height={120}
          data-testid="qr"
        />
        <dl className="hint">
          <dt>Номер сертифіката</dt>
          <dd data-testid="certificate-id">{cert.id}</dd>
          <dt>Ключ підпису (kid)</dt>
          <dd>
            <a href="/.well-known/jwks.json">{cert.kid}</a>
          </dd>
          <dt>SHA-256 даних</dt>
          <dd className="hash" data-testid="sha256">
            {cert.payloadSha256}
          </dd>
        </dl>
      </div>
      <p className="hint no-print">
        Підпис Ed25519 перевіряється на сервері під час кожного відкриття сторінки. Незалежна
        перевірка: <code>node scripts/verify-certificate.mjs &lt;адреса сайту&gt; {cert.id}</code>.
        Сертифікат не містить фото чи біометричних даних.
      </p>
      <PrintButton />
    </div>
  );
}
