import { api, jsonOk } from "@/lib/api";
import { Role } from "@/lib/enums";
import { computeKpis } from "@/components/admin/admin-data";

export const dynamic = "force-dynamic";

/** GET /api/admin/kpis?days=30 — dashboard KPIs over recently paid orders. */
export const GET = api(
  async (req) => {
    const raw = Number(req.nextUrl.searchParams.get("days") ?? "30");
    const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.floor(raw))) : 30;
    return jsonOk(await computeKpis(days));
  },
  { roles: [Role.ADMIN] },
);
