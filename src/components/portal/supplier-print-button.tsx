"use client";

/** "Print packing slip" — the PO detail page carries @media print CSS that
 * hides everything except the packing-slip section. */
export function SupplierPrintButton() {
  return (
    <button type="button" className="btn-secondary" onClick={() => window.print()}>
      Print packing slip
    </button>
  );
}
