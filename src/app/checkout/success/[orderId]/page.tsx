import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { OrderStatus, Role, ShipTo } from "@/lib/enums";
import { formatShopTime, pluralize } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { requirePageUser } from "@/lib/page-auth";
import { destinationKey, TRANSIT_BUFFER_DAYS } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order placed" };

export default async function CheckoutSuccessPage({ params }: { params: { orderId: string } }) {
  const user = await requirePageUser([Role.CUSTOMER], `/checkout/success/${params.orderId}`);

  const order = await db.order.findUnique({
    where: { id: params.orderId },
    include: {
      items: true,
      appointments: { include: { installer: true } },
    },
  });
  if (!order || order.userId !== user.id) notFound();

  // Never celebrate a dead order (stale pay tab after a cancellation) — the
  // order page tells the real story.
  if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
    redirect(`/account/orders/${order.id}`);
  }

  const stillUnpaid =
    order.status === OrderStatus.PENDING_PAYMENT || order.status === OrderStatus.PAYMENT_FAILED;

  // Supplier + installer lookups for the "what happens next" cards.
  const supplierIds = Array.from(new Set(order.items.map((i) => i.supplierId)));
  const suppliers = await db.supplier.findMany({ where: { id: { in: supplierIds } } });
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const installerIds = Array.from(
    new Set(
      order.items.map((i) => i.installerIdSnapshot).filter((x): x is string => Boolean(x)),
    ),
  );
  const installers = await db.installer.findMany({ where: { id: { in: installerIds } } });
  const installerById = new Map(installers.map((s) => [s.id, s]));

  // Shipment groups — same destinationKey the PO fan-out uses.
  const shipmentMap = new Map<
    string,
    { supplierName: string; leadTimeDays: number; destLabel: string; itemNames: string[] }
  >();
  for (const item of order.items) {
    const key = destinationKey(item.supplierId, item.shipTo, item.installerIdSnapshot);
    const supplier = supplierById.get(item.supplierId);
    let entry = shipmentMap.get(key);
    if (!entry) {
      const shop = item.installerIdSnapshot ? installerById.get(item.installerIdSnapshot) : undefined;
      entry = {
        supplierName: supplier?.name ?? "Supplier",
        leadTimeDays: supplier?.leadTimeDays ?? 3,
        destLabel:
          item.shipTo === ShipTo.INSTALLER ? shop?.name ?? "the installer shop" : "your address",
        itemNames: [],
      };
      shipmentMap.set(key, entry);
    }
    entry.itemNames.push(`${item.nameSnapshot} × ${item.qty}`);
  }

  // Appointment cards: real Appointments once paid, requested slots otherwise.
  const apptCards: {
    key: string;
    shopName: string;
    timeLabel: string;
    shipToShop: boolean;
    itemNames: string[];
  }[] = [];
  if (order.appointments.length > 0) {
    for (const appt of order.appointments) {
      const apptItems = order.items.filter((i) => i.appointmentId === appt.id);
      apptCards.push({
        key: appt.id,
        shopName: appt.installer.name,
        timeLabel: formatShopTime(appt.startAt, appt.installer.tzOffsetMinutes),
        shipToShop: apptItems.some((i) => i.shipTo === ShipTo.INSTALLER),
        itemNames: apptItems.map((i) => i.nameSnapshot),
      });
    }
  } else {
    const map = new Map<string, (typeof apptCards)[number]>();
    for (const item of order.items) {
      if (!item.withInstall || !item.installerIdSnapshot || !item.requestedApptStartAt) continue;
      const shop = installerById.get(item.installerIdSnapshot);
      if (!shop) continue;
      const key = `${item.installerIdSnapshot}|${item.requestedApptStartAt.toISOString()}`;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          key,
          shopName: shop.name,
          timeLabel: formatShopTime(item.requestedApptStartAt, shop.tzOffsetMinutes),
          shipToShop: false,
          itemNames: [],
        };
        map.set(key, entry);
      }
      if (item.shipTo === ShipTo.INSTALLER) entry.shipToShop = true;
      entry.itemNames.push(item.nameSnapshot);
    }
    apptCards.push(...Array.from(map.values()));
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {/* ---- Hero ---- */}
      <div className="text-center">
        <p className="text-5xl" aria-hidden>
          {stillUnpaid ? "⏳" : "🎉"}
        </p>
        <h1 className="mt-3 text-3xl font-extrabold text-slate-900">
          {stillUnpaid ? "Almost done" : "Order placed!"}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Order number{" "}
          <span className="font-mono text-base font-bold text-slate-900">{order.orderNumber}</span>
          {" · "}
          {formatCents(order.totalCents)}
        </p>
      </div>

      {stillUnpaid && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          We&apos;re still confirming your payment. This page updates once it clears — refresh in a
          moment, or{" "}
          <Link href={`/checkout/pay/${order.id}`} className="font-semibold underline">
            return to the payment page
          </Link>{" "}
          if it doesn&apos;t.
        </div>
      )}

      {/* ---- What happens next ---- */}
      <h2 className="mb-3 mt-10 text-lg font-bold text-slate-900">What happens next</h2>
      <div className="space-y-3">
        {Array.from(shipmentMap.values()).map((g, idx) => {
          const arrival = g.leadTimeDays + TRANSIT_BUFFER_DAYS;
          return (
            <div key={idx} className="card p-4">
              <p className="text-sm font-semibold text-slate-900">
                📦 {g.supplierName} ships to {g.destLabel}
              </p>
              <p className="mt-1 text-sm text-slate-600">{g.itemNames.join(", ")}</p>
              <p className="mt-1 text-xs text-slate-500">
                The supplier confirms the order, then ships — typically arriving within ~{arrival}{" "}
                {pluralize(arrival, "day")}. You&apos;ll get tracking as soon as it ships.
              </p>
            </div>
          );
        })}

        {apptCards.map((a) => (
          <div key={a.key} className="card p-4">
            <p className="text-sm font-semibold text-slate-900">
              🔧 Installation at {a.shopName} · {a.timeLabel}
            </p>
            <p className="mt-1 text-sm text-slate-600">{a.itemNames.join(", ")}</p>
            <p className="mt-1 text-xs text-slate-500">
              {a.shipToShop
                ? "Your appointment starts as “waiting for parts”: the parts ship straight to the shop, the shop confirms receipt, and your slot flips to ready — we'll notify you at each step."
                : "You chose to receive the parts at home — bring them along to the appointment. The slot is confirmed once your delivery arrives."}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href={`/account/orders/${order.id}`} className="btn-primary">
          Track this order
        </Link>
        <Link href="/parts" className="btn-secondary">
          Keep shopping
        </Link>
      </div>
    </div>
  );
}
