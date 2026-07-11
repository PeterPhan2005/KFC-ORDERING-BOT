import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../src/lib/app-error.js";
import { getMenuItem, resetMenuForTest } from "../src/services/menu.js";
import { clearOrdersForTest, createOrder, updateOrderStatus } from "../src/services/orders.js";
import { createQuote } from "../src/services/pricing.js";

const COMBO_ZINGER = "offline-combo-1-nguoi-combo-burger-zinger-10";

describe("order status transitions", () => {
  beforeEach(() => {
    clearOrdersForTest();
    resetMenuForTest();
  });

  it("allows a pending VNPay order to become paid", async () => {
    const order = await createVnpayOrder();

    expect((await updateOrderStatus(order.id, "PAID")).status).toBe("PAID");
  });

  it("allows a confirmed COD order to become paid after collection", async () => {
    const order = await createOrder({
      items: [{ sku: COMBO_ZINGER, quantity: 1 }],
      paymentMethod: "cod",
      customer: customer()
    });

    expect((await updateOrderStatus(order.id, "PAID")).status).toBe("PAID");
  });

  it("rejects cancellation after a COD order is confirmed", async () => {
    const order = await createOrder({
      items: [{ sku: COMBO_ZINGER, quantity: 1 }],
      paymentMethod: "cod",
      customer: customer()
    });

    await expect(updateOrderStatus(order.id, "CANCELLED")).rejects.toThrow(AppError);
  });

  it("releases reserved stock when pending payment is cancelled", async () => {
    const stockBefore = getMenuItem(COMBO_ZINGER)!.stockQuantity;
    const order = await createVnpayOrder();

    expect(getMenuItem(COMBO_ZINGER)!.stockQuantity).toBe(stockBefore - 1);
    await updateOrderStatus(order.id, "CANCELLED");
    expect(getMenuItem(COMBO_ZINGER)!.stockQuantity).toBe(stockBefore);
  });

  it("allows a coupon to be applied only once after an order is created", async () => {
    await createOrder({
      items: [{ sku: COMBO_ZINGER, quantity: 2 }],
      couponCode: "KFC20",
      paymentMethod: "cod",
      customer: customer()
    });

    const secondQuote = createQuote({
      items: [{ sku: COMBO_ZINGER, quantity: 2 }],
      couponCode: "KFC20",
      paymentMethod: "cod"
    });

    expect(secondQuote.coupon).toMatchObject({
      code: "KFC20",
      isApplied: false,
      reason: "Coupon has already been used."
    });
  });
});

async function createVnpayOrder() {
  return await createOrder({
    items: [{ sku: COMBO_ZINGER, quantity: 1 }],
    paymentMethod: "vnpay",
    customer: customer()
  });
}

function customer() {
  return {
    name: "Peter",
    phone: "0900000000",
    address: "123 Nguyen Trai, District 1, HCMC"
  };
}
