import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { Role, zRole } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { hashPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

const zUserPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(8).max(100).optional(),
  role: zRole.optional(),
  supplierId: z.string().min(1).nullable().optional(),
  installerId: z.string().min(1).nullable().optional(),
});

/**
 * PATCH /api/admin/users/[id] — admin edits a login: rename, reset password,
 * or change role/links. Admins cannot change their OWN role (400).
 */
export const PATCH = api(
  async (req, ctx, user) => {
    const body = await parseBody(req, zUserPatch);
    const target = await db.user.findUnique({ where: { id: ctx.params.id } });
    if (!target) throw new ApiError("NOT_FOUND", "User not found", 404);

    if (body.role !== undefined && target.id === user.id && body.role !== user.role) {
      throw new ApiError("VALIDATION", "You cannot change your own role", 400);
    }

    const nextRole = body.role ?? target.role;
    // Resolve portal links against the effective role.
    let supplierId: string | null = null;
    let installerId: string | null = null;
    if (nextRole === Role.SUPPLIER) {
      supplierId = body.supplierId !== undefined ? body.supplierId : target.supplierId;
      if (!supplierId) {
        throw new ApiError("VALIDATION", "supplierId is required for SUPPLIER users", 400);
      }
      const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new ApiError("NOT_FOUND", "Supplier not found", 400);
    } else if (nextRole === Role.INSTALLER) {
      installerId = body.installerId !== undefined ? body.installerId : target.installerId;
      if (!installerId) {
        throw new ApiError("VALIDATION", "installerId is required for INSTALLER users", 400);
      }
      const installer = await db.installer.findUnique({ where: { id: installerId } });
      if (!installer) throw new ApiError("NOT_FOUND", "Installer not found", 400);
    }

    const passwordHash = body.password ? await hashPassword(body.password) : undefined;

    const updated = await db.user.update({
      where: { id: target.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(passwordHash !== undefined ? { passwordHash } : {}),
        ...(body.role !== undefined || body.supplierId !== undefined || body.installerId !== undefined
          ? { role: nextRole, supplierId, installerId }
          : {}),
      },
    });

    return jsonOk({ id: updated.id, email: updated.email, role: updated.role });
  },
  { roles: [Role.ADMIN] },
);
