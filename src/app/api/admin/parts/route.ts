import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { EntityType, Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/** Category slugs that have a dedicated placeholder SVG. */
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

const zPartCreate = z.object({
  sku: z.string().trim().min(1).max(60),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only"),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4000),
  imageUrl: z.string().trim().max(500).optional().nullable(),
  categoryId: z.string().min(1),
  brandId: z.string().min(1),
  supplierId: z.string().min(1),
  priceCents: z.number().int().min(1),
  supplierCostCents: z.number().int().min(0),
  weightGrams: z.number().int().min(1).optional(),
  installEligible: z.boolean(),
  laborHoursTenths: z.number().int().min(0).max(200),
  installFixedFeeCents: z.number().int().min(0).nullable().optional(),
  universalFit: z.boolean(),
  inStock: z.boolean(),
  active: z.boolean(),
});

/**
 * GET /api/admin/parts?q=&categoryId=&supplierId=&page= — paginated catalog
 * table for the admin parts screen.
 */
export const GET = api(
  async (req) => {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim();
    const categoryId = (sp.get("categoryId") ?? "").trim();
    const supplierId = (sp.get("supplierId") ?? "").trim();
    const rawPage = Number(sp.get("page") ?? "1");
    const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;

    const where = {
      ...(categoryId ? { categoryId } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(q
        ? {
            OR: [{ name: { contains: q } }, { sku: { contains: q } }, { slug: { contains: q } }],
          }
        : {}),
    };

    const [total, parts] = await Promise.all([
      db.part.count({ where }),
      db.part.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          brand: { select: { name: true } },
          supplier: { select: { name: true } },
          category: { select: { name: true, slug: true } },
        },
      }),
    ]);

    return jsonOk({
      page,
      pageSize: PAGE_SIZE,
      total,
      rows: parts.map((p) => ({
        id: p.id,
        sku: p.sku,
        slug: p.slug,
        name: p.name,
        imageUrl: p.imageUrl,
        brandName: p.brand.name,
        supplierName: p.supplier.name,
        categoryName: p.category.name,
        priceCents: p.priceCents,
        supplierCostCents: p.supplierCostCents,
        inStock: p.inStock,
        active: p.active,
      })),
    });
  },
  { roles: [Role.ADMIN] },
);

/** POST /api/admin/parts — create a catalog part (ADMIN). */
export const POST = api(
  async (req, _ctx, user) => {
    const body = await parseBody(req, zPartCreate);

    const [category, brand, supplier, skuClash, slugClash] = await Promise.all([
      db.category.findUnique({ where: { id: body.categoryId } }),
      db.brand.findUnique({ where: { id: body.brandId } }),
      db.supplier.findUnique({ where: { id: body.supplierId } }),
      db.part.findUnique({ where: { sku: body.sku } }),
      db.part.findUnique({ where: { slug: body.slug } }),
    ]);
    if (!category) throw new ApiError("NOT_FOUND", "Category not found", 400);
    if (!brand) throw new ApiError("NOT_FOUND", "Brand not found", 400);
    if (!supplier) throw new ApiError("NOT_FOUND", "Supplier not found", 400);
    if (skuClash) throw new ApiError("DUPLICATE", `SKU "${body.sku}" is already in use`, 409);
    if (slugClash) throw new ApiError("DUPLICATE", `Slug "${body.slug}" is already in use`, 409);

    const imageUrl =
      body.imageUrl && body.imageUrl.length > 0
        ? body.imageUrl
        : placeholderForCategorySlug(category.slug);

    const part = await db.$transaction(async (tx) => {
      const created = await tx.part.create({
        data: {
          sku: body.sku,
          slug: body.slug,
          name: body.name,
          description: body.description,
          imageUrl,
          categoryId: body.categoryId,
          brandId: body.brandId,
          supplierId: body.supplierId,
          priceCents: body.priceCents,
          supplierCostCents: body.supplierCostCents,
          ...(body.weightGrams !== undefined ? { weightGrams: body.weightGrams } : {}),
          installEligible: body.installEligible,
          laborHoursTenths: body.laborHoursTenths,
          installFixedFeeCents: body.installFixedFeeCents ?? null,
          universalFit: body.universalFit,
          inStock: body.inStock,
          active: body.active,
        },
      });
      await logEvent(tx, {
        entityType: EntityType.PART,
        entityId: created.id,
        action: "created",
        actorUserId: user.id,
        actorRole: user.role,
        internal: true,
        message: `Admin created part ${created.sku} — ${created.name}`,
      });
      return created;
    });

    return jsonOk({ id: part.id, slug: part.slug }, 201);
  },
  { roles: [Role.ADMIN] },
);
