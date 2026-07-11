import { randomUUID } from "node:crypto";
import { AppError } from "../lib/app-error.js";
import type { CustomerInfo, Order, OrderStatus, PaymentMethod, QuoteInputItem } from "../types.js";
import { createQuote } from "./pricing.js";

export type CreateOrderInput = {
  items: QuoteInputItem[];
  couponCode?: string;
  paymentMethod: PaymentMethod;
  customer: CustomerInfo;
  notes?: string;
};

const orders = new Map<string, Order>();

export function createOrder(input: CreateOrderInput): Order {
  const now = new Date().toISOString();
  const status: OrderStatus = input.paymentMethod === "cod" ? "CONFIRMED_COD" : "PENDING_PAYMENT";
  const quote = createQuote({
    items: input.items,
    couponCode: input.couponCode,
    paymentMethod: input.paymentMethod,
    deliveryAddress: input.customer.address
  });

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

  orders.set(order.id, order);
  return order;
}

export function getOrder(orderId: string): Order | undefined {
  return orders.get(orderId);
}

export function updateOrderStatus(orderId: string, status: OrderStatus): Order {
  const order = orders.get(orderId);

  if (!order) {
    throw new AppError(404, "Order not found.");
  }

  const updatedOrder: Order = {
    ...order,
    status,
    updatedAt: new Date().toISOString()
  };

  orders.set(orderId, updatedOrder);
  return updatedOrder;
}

export function listOrders(): Order[] {
  return [...orders.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function clearOrdersForTest() {
  orders.clear();
}
