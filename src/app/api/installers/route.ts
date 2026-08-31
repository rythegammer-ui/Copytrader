import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/installers — public. Active installer shops for pickers. */
export const GET = api(async () => {
  const shops = await db.installer.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
      hourlyRateCents: true,
      bays: true,
      slotMinutes: true,
      tzOffsetMinutes: true,
    },
  });
  return jsonOk(shops);
});
