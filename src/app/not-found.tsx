import Link from "next/link";
import { SHOP_PHONE_DISPLAY, SHOP_PHONE_TEL } from "@/lib/shop-contact";

/**
 * 404.
 *
 * Used inventory turns over: a part that sold is deactivated, so a link shared
 * on Marketplace last week can land here. Sending that buyer to the catalog and
 * the shop's phone number keeps the sale alive instead of ending it.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div className="card p-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900">We couldn&apos;t find that page</h1>
        <p className="mt-3 text-slate-600">
          The part may have sold, or the link may be incomplete. Our current stock is all
          on the parts page.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link href="/parts" className="btn-primary">
            Browse parts
          </Link>
          <Link href="/" className="btn-secondary">
            Go home
          </Link>
        </div>

        <p className="mt-8 border-t border-slate-200 pt-6 text-sm text-slate-600">
          Looking for something specific? Call or text{" "}
          <a href={`tel:${SHOP_PHONE_TEL}`} className="font-semibold text-brand-700">
            {SHOP_PHONE_DISPLAY}
          </a>{" "}
          — we can check the shelf and send photos.
        </p>
      </div>
    </div>
  );
}
