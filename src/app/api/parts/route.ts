import type { Prisma } from "@prisma/client";
import { ci } from "@/lib/search";
import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { compatibleWhere, fitmentVerdict, type VehicleContext } from "@/lib/fitment";
import { installUnitCents } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/parts — public catalog search.
 * Filters: q (name/sku/brand contains), categoryId | categorySlug (includes
 * child categories), brandId, install=1, inStock=1, vehicle context via
 * modelId+year(+engineId), sort=price_asc|price_desc|name, page, pageSize.
 * When a vehicle context is given, incompatible parts are EXCLUDED entirely.
 */
export const GET = api(async (req) => {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() || null;
  const categoryId = sp.get("categoryId");
  const categorySlug = sp.get("categorySlug");
  const brandId = sp.get("brandId");
  const install = sp.get("install") === "1";
  const inStockOnly = sp.get("inStock") === "1";
  const sort = sp.get("sort");

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSizeRaw = parseInt(sp.get("pageSize") ?? `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSizeRaw));

  // Vehicle context (query-param driven for this public endpoint).
  const modelId = sp.get("modelId");
  const yearRaw = sp.get("year");
  const year = yearRaw ? parseInt(yearRaw, 10) : NaN;
  const engineId = sp.get("engineId");
  const vehicle: VehicleContext | null =
    modelId && Number.isFinite(year) ? { modelId, year, engineId: engineId || null } : null;

  const and: Prisma.PartWhereInput[] = [{ active: true }];
  if (q) {
    and.push({
      OR: [
        { name: ci(q) },
        { sku: ci(q) },
        { brand: { name: ci(q) } },
      ],
    });
  }
  if (categoryId) {
    and.push({ OR: [{ categoryId }, { category: { parentId: categoryId } }] });
  } else if (categorySlug) {
    and.push({ category: { OR: [{ slug: categorySlug }, { parent: { slug: categorySlug } }] } });
  }
  if (brandId) and.push({ brandId });
  if (install) and.push({ installEligible: true });
  if (inStockOnly) and.push({ inStock: true });
  if (vehicle) and.push(compatibleWhere(vehicle));
  const where: Prisma.PartWhereInput = { AND: and };

  const orderBy: Prisma.PartOrderByWithRelationInput[] =
    sort === "price_asc"
      ? [{ priceCents: "asc" }, { name: "asc" }]
      : sort === "price_desc"
        ? [{ priceCents: "desc" }, { name: "asc" }]
        : [{ name: "asc" }];

  const [total, parts, installers] = await Promise.all([
    db.part.count({ where }),
    db.part.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        brand: { select: { name: true } },
        category: { select: { name: true, slug: true } },
        supplier: { select: { name: true, leadTimeDays: true } },
        fitments: true,
      },
    }),
    db.installer.findMany({
      where: { active: true },
      select: { hourlyRateCents: true },
    }),
  ]);

  const items = parts.map((part) => {
    const installFromCents =
      part.installEligible && installers.length > 0
        ? Math.min(...installers.map((s) => installUnitCents(part, s.hourlyRateCents)))
        : null;
    return {
      id: part.id,
      slug: part.slug,
      name: part.name,
      priceCents: part.priceCents,
      imageUrl: part.imageUrl,
      brand: { name: part.brand.name },
      category: { name: part.category.name, slug: part.category.slug },
      supplier: { name: part.supplier.name, leadTimeDays: part.supplier.leadTimeDays },
      installEligible: part.installEligible,
      inStock: part.inStock,
      universalFit: part.universalFit,
      installFromCents,
      verdict: fitmentVerdict(part, part.fitments, vehicle),
    };
  });

  return jsonOk({ items, total, page, pageSize });
});
