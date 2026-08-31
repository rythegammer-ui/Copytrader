import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { EntityType, Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

const zSupplierCreate = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only"),
  contactEmail: z.string().trim().email(),
  phone: z.string().trim().max(30).nullable().optional(),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().length(2),
  leadTimeDays: z.number().int().min(0).max(60),
  shippingFlatCents: z.number().int().min(0),
  shippingPerItemCents: z.number().int().min(0),
  active: z.boolean(),
});

/** GET /api/admin/suppliers — all suppliers with part counts. */
export const GET = api(
  async () => {
    const suppliers = await db.supplier.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { parts: true } } },
    });
    return jsonOk({
      rows: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        contactEmail: s.contactEmail,
        phone: s.phone,
        city: s.city,
        state: s.state,
        leadTimeDays: s.leadTimeDays,
        shippingFlatCents: s.shippingFlatCents,
        shippingPerItemCents: s.shippingPerItemCents,
        active: s.active,
        partsCount: s._count.parts,
      })),
    });
  },
  { roles: [Role.ADMIN] },
);

/** POST /api/admin/suppliers — create a supplier (ADMIN). */
export const POST = api(
  async (req, _ctx, user) => {
    const body = await parseBody(req, zSupplierCreate);

    const clash = await db.supplier.findUnique({ where: { slug: body.slug } });
    if (clash) throw new ApiError("DUPLICATE", `Slug "${body.slug}" is already in use`, 409);

    const supplier = await db.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: {
          name: body.name,
          slug: body.slug,
          contactEmail: body.contactEmail.toLowerCase(),
          phone: body.phone ?? null,
          city: body.city,
          state: body.state.toUpperCase(),
          leadTimeDays: body.leadTimeDays,
          shippingFlatCents: body.shippingFlatCents,
          shippingPerItemCents: body.shippingPerItemCents,
          active: body.active,
        },
      });
      await logEvent(tx, {
        entityType: EntityType.SUPPLIER,
        entityId: created.id,
        action: "created",
        actorUserId: user.id,
        actorRole: user.role,
        internal: true,
        message: `Admin created supplier ${created.name}`,
      });
      return created;
    });

    return jsonOk({ id: supplier.id }, 201);
  },
  { roles: [Role.ADMIN] },
);
