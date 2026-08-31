import { api, jsonOk } from "@/lib/api";
import { Role } from "@/lib/enums";
import { computeAttention } from "@/components/admin/admin-data";

export const dynamic = "force-dynamic";

/** GET /api/admin/attention — the unified exception queue, red first. */
export const GET = api(
  async () => {
    return jsonOk({ entries: await computeAttention() });
  },
  { roles: [Role.ADMIN] },
);
