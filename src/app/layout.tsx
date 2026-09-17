import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { SiteFooter } from "@/components/shell/SiteFooter";

export const metadata: Metadata = {
  title: {
    default: "PartsPro — Car Parts, Shipped & Installed",
    template: "%s · PartsPro",
  },
  description:
    "Order car parts that fit your vehicle and book professional installation — one checkout, parts and labor together.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        {/* Page-view and traffic counts, so the shop can see which parts the
            Marketplace links actually bring people to. No cookies, no PII. */}
        <Analytics />
      </body>
    </html>
  );
}
