export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  data: T | null;
  /** The server's message followed by every listed problem, ready to show. */
  errors: string[];
}

/** A JSON request for client components. A failed call comes back as readable Ukrainian messages from the server. */
export async function sendJson<T = Record<string, unknown>>(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body: unknown = {},
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, data: null, errors: ['Немає зʼєднання з сервером. Спробуйте ще раз.'] };
  }
  const data = (await res.json().catch(() => null)) as
    (T & { message?: string; issues?: { message: string }[] }) | null;
  if (res.ok) return { ok: true, data, errors: [] };
  return {
    ok: false,
    data: null,
    errors: [
      data?.message ?? 'Щось пішло не так. Спробуйте ще раз.',
      ...(data?.issues ?? []).map((i) => i.message),
    ],
  };
}
