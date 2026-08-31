import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { EntityType, POStatus, Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/** Non-terminal PO statuses = "open" work for a supplier. */
const OPEN_PO_STATUSES: string[] = [
  POStatus.PENDING_CONFIRMATION,
  POStatus.CONFIRMED,
  POStatus.SHIPPED,
];

const zSupplierPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only")
    .optional(),
  contactEmail: z.string().trim().email().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  city: z.string().trim().min(1).max(80).optional(),
  state: z.string().trim().length(2).optional(),
  leadTimeDays: z.number().int().min(0).max(60).optional(),
  shippingFlatCents: z.number().int().min(0).optional(),
  shippingPerItemCents: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

/** GET /api/admin/suppliers/[id] — detail incl. open PO + parts counts. */
export const GET = api(
  async (_req, ctx) => {
    const supplier = await db.supplier.findUnique({ where: { id: ctx.params.id } });
    if (!supplier) throw new ApiError("NOT_FOUND", "Supplier not found", 404);

    const [partsCount, openPoCount] = await Promise.all([
      db.part.count({ where: { supplierId: supplier.id } }),
      db.purchaseOrder.count({
        where: { supplierId: supplier.id, status: { in: OPEN_PO_STATUSES } },
      }),
    ]);

    return jsonOk({
      id: supplier.id,
      name: supplier.name,
      slug: supplier.slug,
      contactEmail: supplier.contactEmail,
      phone: supplier.phone,
      city: supplier.city,
      state: supplier.state,
      leadTimeDays: supplier.leadTimeDays,
      shippingFlatCents: supplier.shippingFlatCents,
      shippingPerItemCents: supplier.shippingPerItemCents,
      active: supplier.active,
      partsCount,
      openPoCount,
    });
  },
  { roles: [Role.ADMIN] },
);

/** PATCH /api/admin/suppliers/[id] — update supplier config (ADMIN). */
export const PATCH = api(
  async (req, ctx, user) => {
    const body = await parseBody(req, zSupplierPatch);
    const supplier = await db.supplier.findUnique({ where: { id: ctx.params.id } });
    if (!supplier) throw new ApiError("NOT_FOUND", "Supplier not found", 404);

    if (body.slug && body.slug !== supplier.slug) {
      const clash = await db.supplier.findUnique({ where: { slug: body.slug } });
      if (clash) throw new ApiError("DUPLICATE", `Slug "${body.slug}" is already in use`, 409);
    }

    const updated = await db.$transaction(async (tx) => {
      const next = await tx.supplier.update({
        where: { id: supplier.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.contactEmail !== undefined
            ? { contactEmail: body.contactEmail.toLowerCase() }
            : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
          ...(body.city !== undefined ? { city: body.city } : {}),
          ...(body.state !== undefined ? { state: body.state.toUpperCase() } : {}),
          ...(body.leadTimeDays !== undefined ? { leadTimeDays: body.leadTimeDays } : {}),
          ...(body.shippingFlatCents !== undefined
            ? { shippingFlatCents: body.shippingFlatCents }
            : {}),
          ...(body.shippingPerItemCents !== undefined
            ? { shippingPerItemCents: body.shippingPerItemCents }
            : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });
      await logEvent(tx, {
        entityType: EntityType.SUPPLIER,
        entityId: supplier.id,
        action: "updated",
        actorUserId: user.id,
        actorRole: user.role,
        internal: true,
        message: `Admin updated supplier ${next.name}`,
        meta: { fields: Object.keys(body) },
      });
      return next;
    });

    return jsonOk({ id: updated.id });
  },
  { roles: [Role.ADMIN] },
);

/** DELETE /api/admin/suppliers/[id] — soft delete: active=false. */
export const DELETE = api(
  async (_req, ctx, user) => {
    const supplier = await db.supplier.findUnique({ where: { id: ctx.params.id } });
    if (!supplier) throw new ApiError("NOT_FOUND", "Supplier not found", 404);

    await db.$transaction(async (tx) => {
      await tx.supplier.update({ where: { id: supplier.id }, data: { active: false } });
      await logEvent(tx, {
        entityType: EntityType.SUPPLIER,
        entityId: supplier.id,
        action: "deactivated",
        actorUserId: user.id,
        actorRole: user.role,
        internal: true,
        message: `Admin deactivated supplier ${supplier.name}`,
      });
    });

    return jsonOk({ ok: true });
  },
  { roles: [Role.ADMIN] },
);
