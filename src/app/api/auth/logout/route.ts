import { api, jsonOk } from "@/lib/api";
import { clearSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

export const POST = api(async () => {
  clearSessionCookie();
  return jsonOk({ ok: true });
});
