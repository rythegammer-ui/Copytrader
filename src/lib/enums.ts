import { z } from "zod";

/**
 * SQLite has no native enums, so enum-like columns are plain strings in the
 * schema. These const objects + zod validators are the single source of truth
 * for the allowed values. Always import from here — never inline a literal.
 */

export const Role = {
  CUSTOMER: "CUSTOMER",
  ADMIN: "ADMIN",
  SUPPLIER: "SUPPLIER",
  INSTALLER: "INSTALLER",
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const zRole = z.enum(["CUSTOMER", "ADMIN", "SUPPLIER", "INSTALLER"]);

export const ShipTo = {
  HOME: "HOME",
  INSTALLER: "INSTALLER",
} as const;
export type ShipTo = (typeof ShipTo)[keyof typeof ShipTo];
export const zShipTo = z.enum(["HOME", "INSTALLER"]);

export const OrderStatus = {
  PENDING_PAYMENT: "PENDING_PAYMENT",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  PAID: "PAID",
  PROCESSING: "PROCESSING",
  PARTIALLY_FULFILLED: "PARTIALLY_FULFILLED",
  FULFILLED: "FULFILLED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
export const zOrderStatus = z.enum([
  "PENDING_PAYMENT",
  "PAYMENT_FAILED",
  "PAID",
  "PROCESSING",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
]);

export const OrderItemStatus = {
  PENDING: "PENDING",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
} as const;
export type OrderItemStatus = (typeof OrderItemStatus)[keyof typeof OrderItemStatus];
export const zOrderItemStatus = z.enum(["PENDING", "CANCELLED", "REFUNDED"]);

export const POStatus = {
  PENDING_CONFIRMATION: "PENDING_CONFIRMATION",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  RECEIVED: "RECEIVED",
  CANCELLED: "CANCELLED",
} as const;
export type POStatus = (typeof POStatus)[keyof typeof POStatus];
export const zPOStatus = z.enum([
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "REJECTED",
  "SHIPPED",
  "DELIVERED",
  "RECEIVED",
  "CANCELLED",
]);

export const AppointmentStatus = {
  PENDING_PARTS: "PENDING_PARTS",
  READY: "READY",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];
export const zAppointmentStatus = z.enum([
  "PENDING_PARTS",
  "READY",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export const PayProvider = {
  STRIPE: "STRIPE",
  MOCK: "MOCK",
} as const;
export type PayProvider = (typeof PayProvider)[keyof typeof PayProvider];
export const zPayProvider = z.enum(["STRIPE", "MOCK"]);

export const PaymentStatus = {
  REQUIRES_PAYMENT: "REQUIRES_PAYMENT",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const zPaymentStatus = z.enum(["REQUIRES_PAYMENT", "SUCCEEDED", "FAILED", "CANCELLED"]);

export const RefundStatus = {
  PENDING: "PENDING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];
export const zRefundStatus = z.enum(["PENDING", "SUCCEEDED", "FAILED"]);

export const EntityType = {
  ORDER: "ORDER",
  PURCHASE_ORDER: "PURCHASE_ORDER",
  APPOINTMENT: "APPOINTMENT",
  PAYMENT: "PAYMENT",
  REFUND: "REFUND",
  PART: "PART",
  SUPPLIER: "SUPPLIER",
  INSTALLER: "INSTALLER",
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

/** PO statuses that count as "terminal-delivered" for an order-fulfillment rollup. */
export function poTerminalDelivered(status: string, shipTo: string): boolean {
  if (shipTo === ShipTo.INSTALLER) return status === POStatus.RECEIVED;
  return status === POStatus.DELIVERED || status === POStatus.RECEIVED;
}

/** Human labels for status pills across the UI. */
export const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "Pending payment",
  PAYMENT_FAILED: "Payment failed",
  PAID: "Paid",
  PROCESSING: "Processing",
  PARTIALLY_FULFILLED: "Partially fulfilled",
  FULFILLED: "Fulfilled",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  PENDING_CONFIRMATION: "Awaiting confirmation",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  RECEIVED: "Received at shop",
  PENDING_PARTS: "Waiting for parts",
  READY: "Ready — confirmed",
  NO_SHOW: "No-show",
  PENDING: "Pending",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  REQUIRES_PAYMENT: "Awaiting payment",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
