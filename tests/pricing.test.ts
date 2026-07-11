import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/app-error.js";
import { createQuote } from "../src/services/pricing.js";

describe("createQuote", () => {
  it("calculates subtotal, delivery fee, and total without coupon", () => {
    const quote = createQuote({
      items: [
        { sku: "FRIED_CHICKEN_2PC", quantity: 2 },
        { sku: "PEPSI_REGULAR", quantity: 1 }
      ]
    });

    expect(quote.subtotal).toBe(158000);
    expect(quote.deliveryFee).toBe(18000);
    expect(quote.itemDiscount).toBe(0);
    expect(quote.deliveryDiscount).toBe(0);
    expect(quote.total).toBe(176000);
  });

  it("applies percentage coupon with max discount rules", () => {
    const quote = createQuote({
      items: [
        { sku: "FRIED_CHICKEN_2PC", quantity: 2 },
        { sku: "PEPSI_REGULAR", quantity: 1 }
      ],
      couponCode: "KFC20"
    });

    expect(quote.coupon).toMatchObject({
      code: "KFC20",
      isApplied: true,
      discount: 31600
    });
    expect(quote.total).toBe(144400);
  });

  it("applies free shipping coupon to delivery only", () => {
    const quote = createQuote({
      items: [{ sku: "COMBO_ZINGER", quantity: 1 }],
      couponCode: "FREESHIP"
    });

    expect(quote.deliveryDiscount).toBe(18000);
    expect(quote.itemDiscount).toBe(0);
    expect(quote.total).toBe(89000);
  });

  it("does not apply a payment-specific coupon when payment method is missing", () => {
    const quote = createQuote({
      items: [{ sku: "COMBO_ZINGER", quantity: 2 }],
      couponCode: "COD15K"
    });

    expect(quote.coupon).toMatchObject({
      code: "COD15K",
      isApplied: false,
      discount: 0,
      reason: "Coupon requires payment method: cod."
    });
  });

  it("throws a client error for unknown SKU", () => {
    expect(() =>
      createQuote({
        items: [{ sku: "UNKNOWN", quantity: 1 }]
      })
    ).toThrow(AppError);
  });
});
