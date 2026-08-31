import { Prisma } from "@prisma/client";
import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const zSlug = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only");

const zCategory = z.object({
  name: z.string().trim().min(1).max(120),
  slug: zSlug,
  parentId: z.string().min(1).nullable().optional(),
});
const zBrand = z.object({ name: z.string().trim().min(1).max(120), slug: zSlug });
const zMake = z.object({ name: z.string().trim().min(1).max(120) });
const zModel = z.object({ makeId: z.string().min(1), name: z.string().trim().min(1).max(120) });
const zEngine = z.object({ modelId: z.string().min(1), name: z.string().trim().min(1).max(120) });

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * POST /api/admin/taxonomy/[kind] — create one taxonomy row.
 * kind ∈ category | brand | make | model | engine. 409 on duplicates.
 */
export const POST = api(
  async (req, ctx) => {
    const kind = ctx.params.kind;
    try {
      switch (kind) {
        case "category": {
          const body = await parseBody(req, zCategory);
          if (body.parentId) {
            const parent = await db.category.findUnique({ where: { id: body.parentId } });
            if (!parent) throw new ApiError("NOT_FOUND", "Parent category not found", 400);
          }
          const created = await db.category.create({
            data: { name: body.name, slug: body.slug, parentId: body.parentId ?? null },
          });
          return jsonOk({ id: created.id }, 201);
        }
        case "brand": {
          const body = await parseBody(req, zBrand);
          const created = await db.brand.create({ data: { name: body.name, slug: body.slug } });
          return jsonOk({ id: created.id }, 201);
        }
        case "make": {
          const body = await parseBody(req, zMake);
          const created = await db.make.create({ data: { name: body.name } });
          return jsonOk({ id: created.id }, 201);
        }
        case "model": {
          const body = await parseBody(req, zModel);
          const make = await db.make.findUnique({ where: { id: body.makeId } });
          if (!make) throw new ApiError("NOT_FOUND", "Make not found", 400);
          const created = await db.vehicleModel.create({
            data: { makeId: body.makeId, name: body.name },
          });
          return jsonOk({ id: created.id }, 201);
        }
        case "engine": {
          const body = await parseBody(req, zEngine);
          const model = await db.vehicleModel.findUnique({ where: { id: body.modelId } });
          if (!model) throw new ApiError("NOT_FOUND", "Vehicle model not found", 400);
          const created = await db.engine.create({
            data: { modelId: body.modelId, name: body.name },
          });
          return jsonOk({ id: created.id }, 201);
        }
        default:
          throw new ApiError("NOT_FOUND", `Unknown taxonomy kind "${kind}"`, 404);
      }
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ApiError("DUPLICATE", `That ${kind} already exists`, 409);
      }
      throw e;
    }
  },
  { roles: [Role.ADMIN] },
);
