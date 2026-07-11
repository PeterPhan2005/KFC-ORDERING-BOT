import { randomUUID } from "node:crypto";
import { isDatabaseEnabled, queryDatabase } from "../lib/database.js";
import { AppError } from "../lib/app-error.js";
import type { CustomerInfo, Order, OrderStatus, PaymentMethod, QuoteInputItem } from "../types.js";
import { publishAdminEvent } from "./admin-events.js";
import { releaseMenuStock, reserveMenuStock } from "./menu.js";
import { createQuote } from "./pricing.js";
import { clearCouponRedemptionsForTest, redeemCoupon, releaseCouponRedemption } from "./coupon-redemptions.js";

export type CreateOrderInput = {
  items: QuoteInputItem[];
  couponCode?: string;
  paymentMethod: PaymentMethod;
  customer: CustomerInfo;
  notes?: string;
};

type OrderRow = {
  id: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  customer: CustomerInfo;
  notes: string | null;
  quote: Order["quote"];
  created_at: Date | string;
  updated_at: Date | string;
};

const memoryOrders = new Map<string, Order>();

const allowedStatusTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  CONFIRMED_COD: ["PAID"],
  PENDING_PAYMENT: ["PAID", "CANCELLED"],
  PAID: [],
  CANCELLED: []
};

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const now = new Date().toISOString();
  const status: OrderStatus = input.paymentMethod === "cod" ? "CONFIRMED_COD" : "PENDING_PAYMENT";
  const quote = createQuote({
    items: input.items,
    couponCode: input.couponCode,
    paymentMethod: input.paymentMethod,
    deliveryAddress: input.customer.address
  });

  reserveMenuStock(input.items);

  const order: Order = {
    id: randomUUID(),
    status,
    paymentMethod: input.paymentMethod,
    customer: input.customer,
    notes: input.notes,
    quote,
    createdAt: now,
    updatedAt: now
  };

  if (quote.coupon?.isApplied) {
    const redeemed = await redeemCoupon(quote.coupon.code, order.id);

    if (!redeemed) {
      releaseMenuStock(input.items);
      throw new AppError(409, "Coupon has already been used.");
    }
  }

  try {
    if (isDatabaseEnabled()) {
      await queryDatabase(
        `INSERT INTO orders (id, status, payment_method, customer, notes, quote, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8)`,
        [
          order.id,
          order.status,
          order.paymentMethod,
          JSON.stringify(order.customer),
          order.notes ?? null,
          JSON.stringify(order.quote),
          order.createdAt,
          order.updatedAt
        ]
      );
    } else {
      memoryOrders.set(order.id, order);
    }
  } catch (error) {
    releaseMenuStock(input.items);

    if (quote.coupon?.isApplied) {
      await releaseCouponRedemption(quote.coupon.code, order.id);
    }

    throw error;
  }

  publishAdminEvent("order_created");
  return order;
}

export async function getOrder(orderId: string): Promise<Order | undefined> {
  if (!isDatabaseEnabled()) {
    return memoryOrders.get(orderId);
  }

  const result = await queryDatabase<OrderRow>("SELECT * FROM orders WHERE id = $1", [orderId]);
  return result.rows[0] ? mapOrderRow(result.rows[0]) : undefined;
}

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order> {
  const order = await getOrder(orderId);

  if (!order) {
    throw new AppError(404, "Order not found.");
  }

  if (order.status === status) {
    return order;
  }

  if (!allowedStatusTransitions[order.status].includes(status)) {
    throw new AppError(409, `Order cannot transition from ${order.status} to ${status}.`);
  }

  const updatedAt = new Date().toISOString();
  if (isDatabaseEnabled()) {
    await queryDatabase("UPDATE orders SET status = $2, updated_at = $3 WHERE id = $1", [orderId, status, updatedAt]);
  } else {
    memoryOrders.set(orderId, { ...order, status, updatedAt });
  }

  if (status === "CANCELLED") {
    releaseMenuStock(order.quote.items);
  }

  const updatedOrder = { ...order, status, updatedAt };
  publishAdminEvent("order_status_updated");
  return updatedOrder;
}

export function getSelectableOrderStatuses(currentStatus: OrderStatus): OrderStatus[] {
  return [currentStatus, ...allowedStatusTransitions[currentStatus]];
}

export async function deleteOrder(orderId: string): Promise<void> {
  const order = await getOrder(orderId);

  if (!order) {
    throw new AppError(404, "Order not found.");
  }

  if (isDatabaseEnabled()) {
    await queryDatabase("DELETE FROM orders WHERE id = $1", [orderId]);
  } else {
    memoryOrders.delete(orderId);
  }

  releaseMenuStock(order.quote.items);
  publishAdminEvent("order_deleted");
}

export async function listOrders(): Promise<Order[]> {
  if (!isDatabaseEnabled()) {
    return [...memoryOrders.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  const result = await queryDatabase<OrderRow>("SELECT * FROM orders ORDER BY created_at DESC");
  return result.rows.map(mapOrderRow);
}

export function clearOrdersForTest() {
  memoryOrders.clear();
  clearCouponRedemptionsForTest();
}

function mapOrderRow(row: OrderRow): Order {
  return {
    id: row.id,
    status: row.status,
    paymentMethod: row.payment_method,
    customer: row.customer,
    notes: row.notes ?? undefined,
    quote: row.quote,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
