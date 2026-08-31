import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { Role } from "@/lib/enums";
import { hashPassword, verifyPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

const zProfilePatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  password: z
    .object({
      current: z.string().min(1).max(200),
      next: z.string().min(8).max(200),
    })
    .optional(),
});

export const PATCH = api(
  async (req, _ctx, user) => {
    const body = await parseBody(req, zProfilePatch);

    const data: { name?: string; phone?: string | null; passwordHash?: string } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.phone !== undefined) data.phone = body.phone === "" ? null : body.phone;

    if (body.password) {
      const ok = await verifyPassword(body.password.current, user.passwordHash);
      if (!ok) {
        throw new ApiError("BAD_CREDENTIALS", "Current password is incorrect", 400);
      }
      data.passwordHash = await hashPassword(body.password.next);
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError("VALIDATION", "Nothing to update", 400);
    }

    const updated = await db.user.update({ where: { id: user.id }, data });

    return jsonOk({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        phone: updated.phone,
      },
    });
  },
  { roles: [Role.CUSTOMER, Role.ADMIN, Role.SUPPLIER, Role.INSTALLER] },
);
