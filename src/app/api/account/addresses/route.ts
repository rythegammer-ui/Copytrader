import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";

export const dynamic = "force-dynamic";

const zAddressCreate = z.object({
  label: z.string().trim().min(1).max(40),
  line1: z.string().trim().min(1).max(120),
  line2: z.string().trim().min(1).max(120).optional(),
  city: z.string().trim().min(1).max(80),
  state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "must be a 2-letter state code")
    .transform((s) => s.toUpperCase()),
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, "must be a valid ZIP code"),
});

export const GET = api(
  async (_req, _ctx, user) => {
    const addresses = await db.address.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: "desc" }, { label: "asc" }],
    });
    return jsonOk({ addresses });
  },
  { roles: [Role.CUSTOMER] },
);

export const POST = api(
  async (req, _ctx, user) => {
    const body = await parseBody(req, zAddressCreate);
    const existingCount = await db.address.count({ where: { userId: user.id } });
    const address = await db.address.create({
      data: {
        userId: user.id,
        label: body.label,
        line1: body.line1,
        line2: body.line2 ?? null,
        city: body.city,
        state: body.state,
        zip: body.zip,
        isDefault: existingCount === 0,
      },
    });
    return jsonOk({ address }, 201);
  },
  { roles: [Role.CUSTOMER] },
);
