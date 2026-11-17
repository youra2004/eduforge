/** Sends a browser-only research event (RESEARCH.md §3). Never throws and never blocks the page: logging must not break learning. */
export function trackEvent(event: Record<string, unknown>) {
  void fetch('/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => undefined);
}
