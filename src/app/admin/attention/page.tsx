import type { Metadata } from "next";
import { Role } from "@/lib/enums";
import { requirePageUser } from "@/lib/page-auth";
import { computeAttention } from "@/components/admin/admin-data";
import { AttentionList } from "@/components/admin/AttentionList";

export const metadata: Metadata = { title: "Attention queue" };
export const dynamic = "force-dynamic";

export default async function AttentionPage() {
  await requirePageUser([Role.ADMIN], "/admin/attention");
  const entries = await computeAttention();
  const red = entries.filter((e) => e.severity === "red");
  const amber = entries.filter((e) => e.severity === "amber");

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">Attention queue</h1>
      <p className="mt-1 text-sm text-slate-600">
        Everything that needs an admin decision — exceptions across purchase orders,
        appointments, and refunds.
      </p>

      <section className="mt-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="badge bg-red-100 text-red-800">Critical</span>
          {red.length} {red.length === 1 ? "item" : "items"}
        </h2>
        <div className="card overflow-hidden">
          <AttentionList entries={red} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="badge bg-amber-100 text-amber-800">Watch</span>
          {amber.length} {amber.length === 1 ? "item" : "items"}
        </h2>
        <div className="card overflow-hidden">
          <AttentionList entries={amber} />
        </div>
      </section>
    </div>
  );
}
