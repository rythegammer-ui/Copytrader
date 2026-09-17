import { describe, it, expect } from "vitest";
import { encodeOrderToken, decodeOrderToken, tokenOpensOrder } from "@/lib/session";
import { deniedOrder, withToken, type OrderViewer } from "@/lib/order-access";
import { Role } from "@/lib/enums";

const ORDER = "ord_abc123";
const OTHER = "ord_zzz999";

function viewer(over: Partial<OrderViewer> = {}): OrderViewer {
  return { viaToken: false, user: null, ...over };
}

function asUser(id: string, role: string = Role.CUSTOMER) {
  // Only the fields deniedOrder reads; the rest of User is irrelevant here.
  return { id, role } as unknown as NonNullable<OrderViewer["user"]>;
}

describe("order access tokens", () => {
  it("opens the order it was minted for", () => {
    expect(tokenOpensOrder(ORDER, encodeOrderToken(ORDER))).toBe(true);
  });

  it("opens nothing else", () => {
    // The whole point: a guest's link is one order, not an account.
    expect(tokenOpensOrder(OTHER, encodeOrderToken(ORDER))).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = encodeOrderToken(ORDER);
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(decodeOrderToken(flipped)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = encodeOrderToken(ORDER);
    const mac = token.slice(token.lastIndexOf(".") + 1);
    const forged = Buffer.from(
      JSON.stringify({ p: "order", orderId: OTHER, exp: 9999999999 }),
    ).toString("base64url");
    expect(decodeOrderToken(`${forged}.${mac}`)).toBeNull();
  });

  it("rejects junk and empties", () => {
    for (const t of ["", "nonsense", "a.b", undefined]) {
      expect(decodeOrderToken(t as string | undefined)).toBeNull();
    }
  });

  it("will not accept a token of a different purpose", () => {
    // A reset token must never double as an order key, and vice versa.
    const orderToken = encodeOrderToken(ORDER);
    const body = orderToken.slice(0, orderToken.lastIndexOf("."));
    // Same body, signed as if it were a session — must not validate.
    expect(decodeOrderToken(`${body}.deadbeef`)).toBeNull();
  });
});

describe("who may see an order", () => {
  it("lets a token holder in without any account", () => {
    expect(deniedOrder(viewer({ viaToken: true }), "someone-else")).toBe(false);
  });

  it("lets the owner in", () => {
    expect(deniedOrder(viewer({ user: asUser("u1") }), "u1")).toBe(false);
  });

  it("keeps a signed-in stranger out of someone else's order", () => {
    expect(deniedOrder(viewer({ user: asUser("u2") }), "u1")).toBe(true);
  });

  it("keeps anonymous visitors out when they carry no token", () => {
    expect(deniedOrder(viewer(), "u1")).toBe(true);
  });

  it("lets an admin in", () => {
    expect(deniedOrder(viewer({ user: asUser("admin", Role.ADMIN) }), "u1")).toBe(false);
  });
});

describe("threading the token through links", () => {
  it("adds it for a guest", () => {
    const v = viewer({ viaToken: true, token: "tok" });
    expect(withToken("/checkout/success/x", v)).toBe("/checkout/success/x?t=tok");
  });

  it("respects an existing query string", () => {
    const v = viewer({ viaToken: true, token: "tok" });
    expect(withToken("/x?a=1", v)).toBe("/x?a=1&t=tok");
  });

  it("leaves a signed-in customer's links alone", () => {
    expect(withToken("/account/orders/x", viewer({ user: asUser("u1") }))).toBe(
      "/account/orders/x",
    );
  });
});
