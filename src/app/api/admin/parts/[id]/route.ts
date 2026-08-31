import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { EntityType, Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

const PLACEHOLDER_SLUGS = new Set([
  "brakes",
  "engine",
  "suspension",
  "electrical",
  "filters",
  "exhaust",
  "cooling",
  "lighting",
  "ignition",
  "accessories",
  "wipers",
]);

function placeholderForCategorySlug(slug: string): string {
  return `/images/placeholders/${PLACEHOLDER_SLUGS.has(slug) ? slug : "part"}.svg`;
}

const zPartPatch = z.object({
  sku: z.string().trim().min(1).max(60).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only")
    .optional(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(4000).optional(),
  imageUrl: z.string().trim().max(500).optional().nullable(),
  categoryId: z.string().min(1).optional(),
  brandId: z.string().min(1).optional(),
  supplierId: z.string().min(1).optional(),
  priceCents: z.number().int().min(1).optional(),
  supplierCostCents: z.number().int().min(0).optional(),
  weightGrams: z.number().int().min(1).optional(),
  installEligible: z.boolean().optional(),
  laborHoursTenths: z.number().int().min(0).max(200).optional(),
  installFixedFeeCents: z.number().int().min(0).nullable().optional(),
  universalFit: z.boolean().optional(),
  inStock: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** GET /api/admin/parts/[id] — part detail incl. fitments with vehicle names. */
export const GET = api(
  async (_req, ctx) => {
    const part = await db.part.findUnique({
      where: { id: ctx.params.id },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        fitments: {
          include: {
            model: { include: { make: { select: { name: true } } } },
            engine: { select: { id: true, name: true } },
          },
          orderBy: { yearFrom: "asc" },
        },
      },
    });
    if (!part) throw new ApiError("NOT_FOUND", "Part not found", 404);

    return jsonOk({
      id: part.id,
      sku: part.sku,
      slug: part.slug,
      name: part.name,
      description: part.description,
      imageUrl: part.imageUrl,
      categoryId: part.categoryId,
      categoryName: part.category.name,
      brandId: part.brandId,
      brandName: part.brand.name,
      supplierId: part.supplierId,
      supplierName: part.supplier.name,
      priceCents: part.priceCents,
      supplierCostCents: part.supplierCostCents,
      weightGrams: part.weightGrams,
      installEligible: part.installEligible,
      laborHoursTenths: part.laborHoursTenths,
      installFixedFeeCents: part.installFixedFeeCents,
      universalFit: part.universalFit,
      inStock: part.inStock,
      active: part.active,
      fitments: part.fitments.map((f) => ({
        id: f.id,
        modelId: f.modelId,
        makeName: f.model.make.name,
        modelName: f.model.name,
        engineId: f.engineId,
        engineName: f.engine?.name ?? null,
        yearFrom: f.yearFrom,
        yearTo: f.yearTo,
        notes: f.notes,
      })),
    });
  },
  { roles: [Role.ADMIN] },
);

/** PATCH /api/admin/parts/[id] — update catalog fields (ADMIN). */
export const PATCH = api(
  async (req, ctx, user) => {
    const body = await parseBody(req, zPartPatch);
    const part = await db.part.findUnique({
      where: { id: ctx.params.id },
      include: { category: { select: { slug: true } } },
    });
    if (!part) throw new ApiError("NOT_FOUND", "Part not found", 404);

    if (body.sku && body.sku !== part.sku) {
      const clash = await db.part.findUnique({ where: { sku: body.sku } });
      if (clash) throw new ApiError("DUPLICATE", `SKU "${body.sku}" is already in use`, 409);
    }
    if (body.slug && body.slug !== part.slug) {
      const clash = await db.part.findUnique({ where: { slug: body.slug } });
      if (clash) throw new ApiError("DUPLICATE", `Slug "${body.slug}" is already in use`, 409);
    }

    let categorySlug = part.category.slug;
    if (body.categoryId && body.categoryId !== part.categoryId) {
      const category = await db.category.findUnique({ where: { id: body.categoryId } });
      if (!category) throw new ApiError("NOT_FOUND", "Category not found", 400);
      categorySlug = category.slug;
    }
    if (body.brandId && body.brandId !== part.brandId) {
      const brand = await db.brand.findUnique({ where: { id: body.brandId } });
      if (!brand) throw new ApiError("NOT_FOUND", "Brand not found", 400);
    }
    if (body.supplierId && body.supplierId !== part.supplierId) {
      const supplier = await db.supplier.findUnique({ where: { id: body.supplierId } });
      if (!supplier) throw new ApiError("NOT_FOUND", "Supplier not found", 400);
    }

    // An explicitly-empty imageUrl falls back to the category placeholder.
    let imageUrl: string | undefined;
    if (body.imageUrl !== undefined) {
      imageUrl =
        body.imageUrl && body.imageUrl.length > 0
          ? body.imageUrl
          : placeholderForCategorySlug(categorySlug);
    }

    const updated = await db.$transaction(async (tx) => {
      const next = await tx.part.update({
        where: { id: part.id },
        data: {
          ...(body.sku !== undefined ? { sku: body.sku } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(imageUrl !== undefined ? { imageUrl } : {}),
          ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
          ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
          ...(body.supplierId !== undefined ? { supplierId: body.supplierId } : {}),
          ...(body.priceCents !== undefined ? { priceCents: body.priceCents } : {}),
          ...(body.supplierCostCents !== undefined
            ? { supplierCostCents: body.supplierCostCents }
            : {}),
          ...(body.weightGrams !== undefined ? { weightGrams: body.weightGrams } : {}),
          ...(body.installEligible !== undefined ? { installEligible: body.installEligible } : {}),
          ...(body.laborHoursTenths !== undefined
            ? { laborHoursTenths: body.laborHoursTenths }
            : {}),
          ...(body.installFixedFeeCents !== undefined
            ? { installFixedFeeCents: body.installFixedFeeCents }
            : {}),
          ...(body.universalFit !== undefined ? { universalFit: body.universalFit } : {}),
          ...(body.inStock !== undefined ? { inStock: body.inStock } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });
      await logEvent(tx, {
        entityType: EntityType.PART,
        entityId: part.id,
        action: "updated",
        actorUserId: user.id,
        actorRole: user.role,
        internal: true,
        message: `Admin updated part ${next.sku} — ${next.name}`,
        meta: { fields: Object.keys(body) },
      });
      return next;
    });

    return jsonOk({ id: updated.id, slug: updated.slug });
  },
  { roles: [Role.ADMIN] },
);

/** DELETE /api/admin/parts/[id] — soft delete: active=false. */
export const DELETE = api(
  async (_req, ctx, user) => {
    const part = await db.part.findUnique({ where: { id: ctx.params.id } });
    if (!part) throw new ApiError("NOT_FOUND", "Part not found", 404);

    await db.$transaction(async (tx) => {
      await tx.part.update({ where: { id: part.id }, data: { active: false } });
      await logEvent(tx, {
        entityType: EntityType.PART,
        entityId: part.id,
        action: "deactivated",
        actorUserId: user.id,
        actorRole: user.role,
        internal: true,
        message: `Admin deactivated part ${part.sku} — ${part.name}`,
      });
    });

    return jsonOk({ ok: true });
  },
  { roles: [Role.ADMIN] },
);
