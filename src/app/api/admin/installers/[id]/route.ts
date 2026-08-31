import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { AppointmentStatus, EntityType, Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

const zInstallerPatch = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only")
      .optional(),
    hourlyRateCents: z.number().int().min(1).optional(),
    line1: z.string().trim().min(1).max(160).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    state: z.string().trim().length(2).optional(),
    zip: z.string().trim().min(3).max(12).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    bays: z.number().int().min(1).max(20).optional(),
    openMinutes: z.number().int().min(0).max(1440).optional(),
    closeMinutes: z.number().int().min(0).max(1440).optional(),
    slotMinutes: z.number().int().min(15).max(480).optional(),
    daysOpenMask: z.number().int().min(1).max(127).optional(),
    tzOffsetMinutes: z.number().int().min(-720).max(840).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (b) =>
      b.openMinutes === undefined || b.closeMinutes === undefined || b.closeMinutes > b.openMinutes,
    { message: "closeMinutes must be after openMinutes", path: ["closeMinutes"] },
  );

/** GET /api/admin/installers/[id] — detail incl. upcoming appointment count. */
export const GET = api(
  async (_req, ctx) => {
    const installer = await db.installer.findUnique({ where: { id: ctx.params.id } });
    if (!installer) throw new ApiError("NOT_FOUND", "Installer not found", 404);

    const upcomingAppointments = await db.appointment.count({
      where: {
        installerId: installer.id,
        startAt: { gte: new Date() },
        status: { in: [AppointmentStatus.PENDING_PARTS, AppointmentStatus.READY] },
      },
    });

    return jsonOk({
      id: installer.id,
      name: installer.name,
      slug: installer.slug,
      hourlyRateCents: installer.hourlyRateCents,
      line1: installer.line1,
      city: installer.city,
      state: installer.state,
      zip: installer.zip,
      phone: installer.phone,
      bays: installer.bays,
      openMinutes: installer.openMinutes,
      closeMinutes: installer.closeMinutes,
      slotMinutes: installer.slotMinutes,
      daysOpenMask: installer.daysOpenMask,
      tzOffsetMinutes: installer.tzOffsetMinutes,
      active: installer.active,
      upcomingAppointments,
    });
  },
  { roles: [Role.ADMIN] },
);

/** PATCH /api/admin/installers/[id] — update shop config (ADMIN). */
export const PATCH = api(
  async (req, ctx, user) => {
    const body = await parseBody(req, zInstallerPatch);
    const installer = await db.installer.findUnique({ where: { id: ctx.params.id } });
    if (!installer) throw new ApiError("NOT_FOUND", "Installer not found", 404);

    if (body.slug && body.slug !== installer.slug) {
      const clash = await db.installer.findUnique({ where: { slug: body.slug } });
      if (clash) throw new ApiError("DUPLICATE", `Slug "${body.slug}" is already in use`, 409);
    }

    // Guard hours when only one side of the window is being changed.
    const nextOpen = body.openMinutes ?? installer.openMinutes;
    const nextClose = body.closeMinutes ?? installer.closeMinutes;
    if (nextClose <= nextOpen) {
      throw new ApiError("VALIDATION", "Closing time must be after opening time", 400);
    }

    const updated = await db.$transaction(async (tx) => {
      const next = await tx.installer.update({
        where: { id: installer.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.hourlyRateCents !== undefined ? { hourlyRateCents: body.hourlyRateCents } : {}),
          ...(body.line1 !== undefined ? { line1: body.line1 } : {}),
          ...(body.city !== undefined ? { city: body.city } : {}),
          ...(body.state !== undefined ? { state: body.state.toUpperCase() } : {}),
          ...(body.zip !== undefined ? { zip: body.zip } : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
          ...(body.bays !== undefined ? { bays: body.bays } : {}),
          ...(body.openMinutes !== undefined ? { openMinutes: body.openMinutes } : {}),
          ...(body.closeMinutes !== undefined ? { closeMinutes: body.closeMinutes } : {}),
          ...(body.slotMinutes !== undefined ? { slotMinutes: body.slotMinutes } : {}),
          ...(body.daysOpenMask !== undefined ? { daysOpenMask: body.daysOpenMask } : {}),
          ...(body.tzOffsetMinutes !== undefined ? { tzOffsetMinutes: body.tzOffsetMinutes } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });
      await logEvent(tx, {
        entityType: EntityType.INSTALLER,
        entityId: installer.id,
        action: "updated",
        actorUserId: user.id,
        actorRole: user.role,
        internal: true,
        message: `Admin updated installer shop ${next.name}`,
        meta: { fields: Object.keys(body) },
      });
      return next;
    });

    return jsonOk({ id: updated.id });
  },
  { roles: [Role.ADMIN] },
);

/** DELETE /api/admin/installers/[id] — soft delete: active=false. */
export const DELETE = api(
  async (_req, ctx, user) => {
    const installer = await db.installer.findUnique({ where: { id: ctx.params.id } });
    if (!installer) throw new ApiError("NOT_FOUND", "Installer not found", 404);

    await db.$transaction(async (tx) => {
      await tx.installer.update({ where: { id: installer.id }, data: { active: false } });
      await logEvent(tx, {
        entityType: EntityType.INSTALLER,
        entityId: installer.id,
        action: "deactivated",
        actorUserId: user.id,
        actorRole: user.role,
        internal: true,
        message: `Admin deactivated installer shop ${installer.name}`,
      });
    });

    return jsonOk({ ok: true });
  },
  { roles: [Role.ADMIN] },
);
