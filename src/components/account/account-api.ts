/**
 * Tiny client-side fetch helper for the account/auth client components.
 * Pure browser code — no server-only imports.
 */

export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export async function sendJson<T = unknown>(
  url: string,
  method: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      let msg = "Request failed";
      if (data && typeof data === "object" && "error" in data) {
        const err = (data as { error?: { message?: unknown } }).error;
        if (err && typeof err.message === "string") msg = err.message;
      }
      return { ok: false, error: msg };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Network error — please try again" };
  }
}
