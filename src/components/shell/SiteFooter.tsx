import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm text-slate-500 sm:grid-cols-3 sm:px-6">
        <div>
          <div className="mb-2 text-base font-bold text-slate-800">🔧 PartsPro</div>
          <p>
            Car parts shipped from trusted suppliers, with professional installation booked and paid
            in the same checkout.
          </p>
        </div>
        <div>
          <div className="mb-2 font-semibold text-slate-700">Shop</div>
          <ul className="space-y-1">
            <li>
              <Link href="/parts" className="hover:text-brand-700">
                All parts
              </Link>
            </li>
            <li>
              <Link href="/cart" className="hover:text-brand-700">
                Cart
              </Link>
            </li>
            <li>
              <Link href="/account/orders" className="hover:text-brand-700">
                Order history
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <div className="mb-2 font-semibold text-slate-700">Policies</div>
          <ul className="space-y-1">
            <li>Whole-item cancellations only; self-serve until a supplier confirms.</li>
            <li>Install cancellations free up to 24 hours before your appointment.</li>
            <li>Demo store — no real charges or shipments.</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
