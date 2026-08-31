import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { Role } from "@/lib/enums";

export const dynamic = "force-dynamic";

const zAddressPatch = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  line1: z.string().trim().min(1).max(120).optional(),
  line2: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().min(1).max(80).optional(),
  state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "must be a 2-letter state code")
    .transform((s) => s.toUpperCase())
    .optional(),
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, "must be a valid ZIP code")
    .optional(),
  isDefault: z.boolean().optional(),
});

export const PATCH = api(
  async (req, ctx, user) => {
    const body = await parseBody(req, zAddressPatch);

    const address = await db.address.findFirst({
      where: { id: ctx.params.id, userId: user.id },
    });
    if (!address) throw new ApiError("NOT_FOUND", "Address not found", 404);

    const data: {
      label?: string;
      line1?: string;
      line2?: string | null;
      city?: string;
      state?: string;
      zip?: string;
    } = {};
    if (body.label !== undefined) data.label = body.label;
    if (body.line1 !== undefined) data.line1 = body.line1;
    if (body.line2 !== undefined) data.line2 = body.line2 === "" ? null : body.line2;
    if (body.city !== undefined) data.city = body.city;
    if (body.state !== undefined) data.state = body.state;
    if (body.zip !== undefined) data.zip = body.zip;

    let updated;
    if (body.isDefault === true && !address.isDefault) {
      // Exactly one default: clear the others and set this one atomically.
      const [, u] = await db.$transaction([
        db.address.updateMany({
          where: { userId: user.id, NOT: { id: address.id } },
          data: { isDefault: false },
        }),
        db.address.update({
          where: { id: address.id },
          data: { ...data, isDefault: true },
        }),
      ]);
      updated = u;
    } else {
      updated = await db.address.update({ where: { id: address.id }, data });
    }

    return jsonOk({ address: updated });
  },
  { roles: [Role.CUSTOMER] },
);

export const DELETE = api(
  async (_req, ctx, user) => {
    const address = await db.address.findFirst({
      where: { id: ctx.params.id, userId: user.id },
    });
    if (!address) throw new ApiError("NOT_FOUND", "Address not found", 404);

    await db.$transaction(async (tx) => {
      await tx.address.delete({ where: { id: address.id } });
      if (address.isDefault) {
        // Promote another address (if any) so a default always exists.
        const next = await tx.address.findFirst({
          where: { userId: user.id },
          orderBy: { label: "asc" },
        });
        if (next) {
          await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    });

    return jsonOk({ ok: true });
  },
  { roles: [Role.CUSTOMER] },
);
