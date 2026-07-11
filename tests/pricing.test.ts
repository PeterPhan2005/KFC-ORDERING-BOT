import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/app-error.js";
import { createQuote } from "../src/services/pricing.js";

const COMBO_ZINGER = "offline-combo-1-nguoi-combo-burger-zinger-10";
const COMBO_TIEU_TUNG_CHILL = "offline-uu-dai-combo-tieu-tung-chill-85k-7";
const PEPSI = "offline-thuc-uong-trang-mieng-pepsi-tieu-chuan-3";

describe("createQuote", () => {
  it("calculates subtotal, delivery fee, and total without coupon", () => {
    const quote = createQuote({
      items: [
        { sku: COMBO_ZINGER, quantity: 2 },
        { sku: PEPSI, quantity: 1 }
      ]
    });

    expect(quote.subtotal).toBe(171000);
    expect(quote.deliveryFee).toBe(20000);
    expect(quote.itemDiscount).toBe(0);
    expect(quote.deliveryDiscount).toBe(0);
    expect(quote.total).toBe(191000);
  });

  it("applies percentage coupon with max discount rules", () => {
    const quote = createQuote({
      items: [
        { sku: COMBO_ZINGER, quantity: 2 },
        { sku: PEPSI, quantity: 1 }
      ],
      couponCode: "KFC20"
    });

    expect(quote.coupon).toMatchObject({
      code: "KFC20",
      isApplied: true,
      discount: 34200
    });
    expect(quote.total).toBe(156800);
  });

  it("applies free shipping coupon to delivery only", () => {
    const quote = createQuote({
      items: [{ sku: COMBO_TIEU_TUNG_CHILL, quantity: 1 }],
      couponCode: "FREESHIP"
    });

    expect(quote.deliveryDiscount).toBe(20000);
    expect(quote.itemDiscount).toBe(0);
    expect(quote.total).toBe(85000);
  });

  it("does not apply a payment-specific coupon when payment method is missing", () => {
    const quote = createQuote({
      items: [{ sku: COMBO_ZINGER, quantity: 2 }],
      couponCode: "COD15K"
    });

    expect(quote.coupon).toMatchObject({
      code: "COD15K",
      isApplied: false,
      discount: 0,
      reason: "Coupon requires payment method: cod."
    });
  });

  it("applies the seeded 100 percent coupon to food items only", () => {
    const quote = createQuote({
      items: [{ sku: COMBO_ZINGER, quantity: 1 }],
      couponCode: "SAVE100"
    });

    expect(quote.itemDiscount).toBe(79000);
    expect(quote.deliveryFee).toBe(20000);
    expect(quote.total).toBe(20000);
  });

  it("throws a client error for unknown SKU", () => {
    expect(() =>
      createQuote({
        items: [{ sku: "UNKNOWN", quantity: 1 }]
      })
    ).toThrow(AppError);
  });
});
