import { api, jsonOk } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = api(async (_req, _ctx, user) => {
  return jsonOk({
    user: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
        }
      : null,
  });
});
