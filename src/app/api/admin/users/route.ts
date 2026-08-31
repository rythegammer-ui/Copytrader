import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { Role, zRole } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { hashPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

const zUserCreate = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(100),
  name: z.string().trim().min(1).max(120),
  role: zRole,
  supplierId: z.string().min(1).nullable().optional(),
  installerId: z.string().min(1).nullable().optional(),
});

/** GET /api/admin/users?role= — user directory with portal links. */
export const GET = api(
  async (req) => {
    const roleParse = zRole.safeParse(req.nextUrl.searchParams.get("role"));
    const users = await db.user.findMany({
      where: roleParse.success ? { role: roleParse.data } : {},
      orderBy: { email: "asc" },
      include: {
        supplier: { select: { name: true } },
        installer: { select: { name: true } },
      },
    });
    return jsonOk({
      rows: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        supplierId: u.supplierId,
        supplierName: u.supplier?.name ?? null,
        installerId: u.installerId,
        installerName: u.installer?.name ?? null,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  },
  { roles: [Role.ADMIN] },
);

/**
 * POST /api/admin/users — create a login (ADMIN). Portal roles must be linked:
 * supplierId iff SUPPLIER, installerId iff INSTALLER.
 */
export const POST = api(
  async (req) => {
    const body = await parseBody(req, zUserCreate);
    const email = body.email.toLowerCase();

    const supplierId = body.supplierId ?? null;
    const installerId = body.installerId ?? null;

    if (body.role === Role.SUPPLIER) {
      if (!supplierId) throw new ApiError("VALIDATION", "supplierId is required for SUPPLIER users", 400);
      const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new ApiError("NOT_FOUND", "Supplier not found", 400);
    } else if (supplierId) {
      throw new ApiError("VALIDATION", "supplierId is only allowed for SUPPLIER users", 400);
    }

    if (body.role === Role.INSTALLER) {
      if (!installerId) throw new ApiError("VALIDATION", "installerId is required for INSTALLER users", 400);
      const installer = await db.installer.findUnique({ where: { id: installerId } });
      if (!installer) throw new ApiError("NOT_FOUND", "Installer not found", 400);
    } else if (installerId) {
      throw new ApiError("VALIDATION", "installerId is only allowed for INSTALLER users", 400);
    }

    const clash = await db.user.findUnique({ where: { email } });
    if (clash) throw new ApiError("DUPLICATE", `A user with email ${email} already exists`, 409);

    const passwordHash = await hashPassword(body.password);
    const created = await db.user.create({
      data: {
        email,
        passwordHash,
        name: body.name,
        role: body.role,
        supplierId: body.role === Role.SUPPLIER ? supplierId : null,
        installerId: body.role === Role.INSTALLER ? installerId : null,
      },
    });

    return jsonOk({ id: created.id, email: created.email, role: created.role }, 201);
  },
  { roles: [Role.ADMIN] },
);
