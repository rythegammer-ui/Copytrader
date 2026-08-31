/**
 * Pure display helpers for the installer portal — safe to import from server
 * components, API routes, AND client components (only touches enums).
 */
import { OrderItemStatus, POStatus, ShipTo } from "@/lib/enums";

/**
 * Where is this appointment item's part right now, from the shop's point of
 * view? Ship-to-shop items arrive at the shop; ship-to-home items are
 * bring-your-own-part — the customer carries them in after home delivery.
 */
export function itemArrivalState(
  itemStatus: string,
  shipTo: string,
  poStatus: string | null | undefined,
): string {
  if (itemStatus !== OrderItemStatus.PENDING) return "Cancelled";
  if (!poStatus) return "Awaiting supplier";
  if (poStatus === POStatus.REJECTED) return "Rejected by supplier";
  if (poStatus === POStatus.CANCELLED) return "Cancelled";

  if (shipTo === ShipTo.INSTALLER) {
    switch (poStatus) {
      case POStatus.RECEIVED:
        return "At your shop";
      case POStatus.DELIVERED:
        return "Delivered — confirm receipt";
      case POStatus.SHIPPED:
        return "In transit to your shop";
      case POStatus.CONFIRMED:
        return "Supplier preparing";
      default:
        return "Awaiting supplier confirmation";
    }
  }
  // HOME: customer brings the part once it lands at their door.
  switch (poStatus) {
    case POStatus.DELIVERED:
    case POStatus.RECEIVED:
      return "Customer brings it";
    case POStatus.SHIPPED:
      return "In transit to customer";
    case POStatus.CONFIRMED:
      return "Supplier preparing";
    default:
      return "Awaiting supplier confirmation";
  }
}

/** Badge color for an arrival state string (paired with .badge). */
export function arrivalBadgeClass(state: string): string {
  switch (state) {
    case "At your shop":
    case "Customer brings it":
      return "bg-green-100 text-green-800";
    case "Delivered — confirm receipt":
      return "bg-blue-100 text-blue-800";
    case "In transit to your shop":
    case "In transit to customer":
      return "bg-indigo-100 text-indigo-800";
    case "Rejected by supplier":
      return "bg-red-100 text-red-800";
    case "Cancelled":
      return "bg-slate-100 text-slate-800";
    default:
      return "bg-amber-100 text-amber-800";
  }
}

export interface ArrivalItemLike {
  itemStatus: string;
  shipTo: string;
  poStatus: string | null | undefined;
}

/** "2 of 3 parts in hand" summary for an appointment row (shop's view). */
export function partsInHandSummary(items: ArrivalItemLike[]): string {
  const live = items.filter((i) => i.itemStatus === OrderItemStatus.PENDING);
  const inHand = live.filter((i) => {
    const state = itemArrivalState(i.itemStatus, i.shipTo, i.poStatus);
    return state === "At your shop" || state === "Customer brings it";
  }).length;
  return `${inHand} of ${live.length} parts in hand`;
}
