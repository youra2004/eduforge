'use client';

/** F10-R5: the printable version is the page itself; the browser's print dialog saves it as PDF. */
export function PrintButton() {
  return (
    <button
      type="button"
      className="secondary no-print"
      onClick={() => window.print()}
      data-testid="print"
    >
      Друк / зберегти як PDF
    </button>
  );
}
