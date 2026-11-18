import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { answerAll, passGate, publishedCourse, studentWhoFinished } from './exam-helpers';

const proof = '.local-agent/proof/m11';
mkdirSync(proof, { recursive: true });
const base = `http://localhost:${process.env.E2E_PORT ?? 3100}`;

/** The independent script: Node's crypto only, reads the public endpoints like any third party would. */
const verifyWithScript = (id: string) => {
  try {
    return {
      code: 0,
      out: execFileSync('node', ['scripts/verify-certificate.mjs', base, id], { encoding: 'utf8' }),
    };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { code: e.status, out: e.stdout };
  }
};

test('exam → certificate → public /verify without an account → admin revokes → shown as invalid', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { versionId, admin } = await publishedCourse(browser);
  const { page } = await studentWhoFinished(browser, versionId);

  await page.goto(`/courses/${versionId}/exam`);
  await page.getByTestId('exam-agree').check();
  await page.getByTestId('exam-consent').check();
  await page.getByTestId('exam-start').click();
  await passGate(page);
  await answerAll(page, 16);
  await expect(page.getByTestId('exam-verdict')).toHaveText('Іспит складено');
  // The certificate is issued by the server as the exam ends.
  await expect(page.getByTestId('certificate-link')).toBeVisible();
  await page.screenshot({ path: `${proof}/1-result-with-certificate.png`, fullPage: true });

  const href = await page.getByTestId('certificate-link').getAttribute('href');
  const id = href!.split('/').pop()!;
  await page.getByTestId('certificate-link').click();
  await expect(page.getByTestId('certificate-status')).toHaveText('Сертифікат дійсний');

  // A guest: no cookies, no account.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/verify/${id}`);
  await expect(guest.getByTestId('certificate-status')).toHaveText('Сертифікат дійсний');
  await expect(guest.getByTestId('holder')).toHaveText('Студентка');
  await expect(guest.getByTestId('score')).toContainText('80');
  await expect(guest.getByTestId('skill')).toHaveCount(11);
  await expect(guest.getByTestId('qr')).toBeVisible();
  await expect(guest.getByTestId('certificate-id')).toHaveText(id);
  expect(await guest.locator('img, video, canvas').count()).toBe(1); // the QR code only: no portrait
  await guest.screenshot({ path: `${proof}/2-verify-public.png`, fullPage: true });
  await guest.emulateMedia({ media: 'print' });
  await expect(guest.locator('.site-header')).toBeHidden();
  await guest.screenshot({ path: `${proof}/3-verify-print.png`, fullPage: true });
  await guest.emulateMedia({ media: 'screen' });

  // The public key by kid, and the script that needs nothing from this repository.
  const cert = await (await guest.request.get(`/api/certificates/${id}`)).json();
  const jwks = await (await guest.request.get('/.well-known/jwks.json')).json();
  // The signed data has the fields of F10-R1 and nothing else: no photo, no email, no biometrics.
  expect(Object.keys(cert.payload).sort()).toEqual([
    'certificate_id',
    'course',
    'holder_name',
    'issued_at',
    'kid',
    'rating',
    'score_pct',
    'skills',
    'summary_text',
  ]);
  expect(jwks.keys.map((k: { kid: string }) => k.kid)).toContain(cert.kid);
  expect(verifyWithScript(id)).toMatchObject({ code: 0 });

  await page.goto('/student');
  await expect(page.getByTestId('my-certificates')).toContainText('Основи Python');
  await page.screenshot({ path: `${proof}/4-student-certificates.png`, fullPage: true });

  // Admin: the list, then a revocation with a reason.
  await admin.goto('/admin');
  await admin.getByTestId('certificates-link').click();
  const row = admin
    .getByTestId('certificate-row')
    .filter({ has: admin.locator(`a[href="/verify/${id}"]`) });
  await expect(row.getByTestId('certificate-state')).toHaveText('Дійсний');
  await row.getByTestId('revoke-reason').fill('Видано помилково (e2e)');
  await admin.screenshot({ path: `${proof}/5-admin-certificates.png`, fullPage: true });
  await row.getByTestId('revoke-submit').click();
  await expect(row.getByTestId('certificate-state')).toContainText('Відкликано');
  await admin.screenshot({ path: `${proof}/6-admin-revoked.png`, fullPage: true });

  await guest.reload();
  await expect(guest.getByTestId('certificate-status')).toHaveText('Сертифікат відкликано');
  await expect(guest.getByText('Видано помилково')).toHaveCount(0); // the reason is for admins
  await guest.screenshot({ path: `${proof}/7-verify-revoked.png`, fullPage: true });
  expect(verifyWithScript(id).code).toBe(1);

  // Not a certificate: the public page is a 404, not an error.
  const missing = await guest.goto('/verify/00000000-0000-4000-8000-000000000000');
  expect(missing!.status()).toBe(404);
});
