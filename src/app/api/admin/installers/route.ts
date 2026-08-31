import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { EntityType, Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

const zInstallerCreate = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only"),
    hourlyRateCents: z.number().int().min(1),
    line1: z.string().trim().min(1).max(160),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().length(2),
    zip: z.string().trim().min(3).max(12),
    phone: z.string().trim().max(30).nullable().optional(),
    bays: z.number().int().min(1).max(20),
    openMinutes: z.number().int().min(0).max(1440),
    closeMinutes: z.number().int().min(0).max(1440),
    slotMinutes: z.number().int().min(15).max(480),
    daysOpenMask: z.number().int().min(1).max(127),
    tzOffsetMinutes: z.number().int().min(-720).max(840),
    active: z.boolean(),
  })
  .refine((b) => b.closeMinutes > b.openMinutes, {
    message: "closeMinutes must be after openMinutes",
    path: ["closeMinutes"],
  });

/** GET /api/admin/installers — all installer shops. */
export const GET = api(
  async () => {
    const installers = await db.installer.findMany({ orderBy: { name: "asc" } });
    return jsonOk({
      rows: installers.map((i) => ({
        id: i.id,
        name: i.name,
        slug: i.slug,
        hourlyRateCents: i.hourlyRateCents,
        line1: i.line1,
        city: i.city,
        state: i.state,
        zip: i.zip,
        phone: i.phone,
        bays: i.bays,
        openMinutes: i.openMinutes,
        closeMinutes: i.closeMinutes,
        slotMinutes: i.slotMinutes,
        daysOpenMask: i.daysOpenMask,
        tzOffsetMinutes: i.tzOffsetMinutes,
        active: i.active,
      })),
    });
  },
  { roles: [Role.ADMIN] },
);

/** POST /api/admin/installers — create an installer shop (ADMIN). */
export const POST = api(
  async (req, _ctx, user) => {
    const body = await parseBody(req, zInstallerCreate);

    const clash = await db.installer.findUnique({ where: { slug: body.slug } });
    if (clash) throw new ApiError("DUPLICATE", `Slug "${body.slug}" is already in use`, 409);

    const installer = await db.$transaction(async (tx) => {
      const created = await tx.installer.create({
        data: {
          name: body.name,
          slug: body.slug,
          hourlyRateCents: body.hourlyRateCents,
          line1: body.line1,
          city: body.city,
          state: body.state.toUpperCase(),
          zip: body.zip,
          phone: body.phone ?? null,
          bays: body.bays,
          openMinutes: body.openMinutes,
          closeMinutes: body.closeMinutes,
          slotMinutes: body.slotMinutes,
          daysOpenMask: body.daysOpenMask,
          tzOffsetMinutes: body.tzOffsetMinutes,
          active: body.active,
        },
      });
      await logEvent(tx, {
        entityType: EntityType.INSTALLER,
        entityId: created.id,
        action: "created",
        actorUserId: user.id,
        actorRole: user.role,
        internal: true,
        message: `Admin created installer shop ${created.name}`,
      });
      return created;
    });

    return jsonOk({ id: installer.id }, 201);
  },
  { roles: [Role.ADMIN] },
);
