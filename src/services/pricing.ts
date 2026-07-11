import { couponsByCode } from "../data/coupons.js";
import { AppError } from "../lib/app-error.js";
import type { Coupon, CouponResult, OrderQuote, QuoteInput } from "../types.js";
import { getMenuItem } from "./menu.js";
import { isCouponRedeemed } from "./coupon-redemptions.js";

const DELIVERY_FEE = 20000;

export function createQuote(input: QuoteInput, now = new Date()): OrderQuote {
  if (input.items.length === 0) {
    throw new AppError(400, "Order must include at least one item.");
  }

  const lines = input.items.map((inputItem) => {
    const menuItem = getMenuItem(inputItem.sku);

    if (!menuItem) {
      throw new AppError(400, `Unknown menu SKU: ${inputItem.sku}`);
    }

    if (!menuItem.isAvailable) {
      throw new AppError(409, `${menuItem.name} is currently unavailable.`);
    }

    if (menuItem.stockQuantity < inputItem.quantity) {
      throw new AppError(409, `${menuItem.name} only has ${menuItem.stockQuantity} item(s) left.`);
    }

    const lineTotal = menuItem.price * inputItem.quantity;

    return {
      sku: menuItem.sku,
      name: menuItem.name,
      quantity: inputItem.quantity,
      unitPrice: menuItem.price,
      lineTotal
    };
  });

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const deliveryFee = DELIVERY_FEE;
  const coupon = input.couponCode
    ? applyCoupon({
        couponCode: input.couponCode,
        subtotal,
        deliveryFee,
        paymentMethod: input.paymentMethod,
        now
      })
    : undefined;

  const itemDiscount = coupon?.isApplied && coupon.code !== "FREESHIP" ? coupon.discount : 0;
  const deliveryDiscount = coupon?.isApplied && coupon.code === "FREESHIP" ? deliveryFee : 0;
  const total = Math.max(0, subtotal - itemDiscount + deliveryFee - deliveryDiscount);

  return {
    items: lines,
    subtotal,
    itemDiscount,
    deliveryFee,
    deliveryDiscount,
    total,
    coupon,
    currency: "VND"
  };
}

function applyCoupon(input: {
  couponCode: string;
  subtotal: number;
  deliveryFee: number;
  paymentMethod?: QuoteInput["paymentMethod"];
  now: Date;
}): CouponResult {
  const normalizedCode = input.couponCode.trim().toUpperCase();
  const coupon = couponsByCode.get(normalizedCode);

  if (!coupon) {
    return invalidCoupon(normalizedCode, "Coupon code does not exist.");
  }

  const invalidReason = getCouponInvalidReason(coupon, input.subtotal, input.paymentMethod, input.now);

  if (invalidReason) {
    return invalidCoupon(normalizedCode, invalidReason);
  }

  if (coupon.type === "free_shipping") {
    return {
      code: coupon.code,
      isApplied: true,
      discount: input.deliveryFee
    };
  }

  if (coupon.type === "fixed") {
    return {
      code: coupon.code,
      isApplied: true,
      discount: Math.min(coupon.value, input.subtotal)
    };
  }

  const rawDiscount = Math.floor((input.subtotal * coupon.value) / 100);
  const discount = coupon.maxDiscount ? Math.min(rawDiscount, coupon.maxDiscount) : rawDiscount;

  return {
    code: coupon.code,
    isApplied: true,
    discount
  };
}

function getCouponInvalidReason(
  coupon: Coupon,
  subtotal: number,
  paymentMethod: QuoteInput["paymentMethod"],
  now: Date
) {
  if (!coupon.isActive) {
    return "Coupon is inactive.";
  }

  if (isCouponRedeemed(coupon.code)) {
    return "Coupon has already been used.";
  }

  if (new Date(coupon.expiresAt) < now) {
    return "Coupon has expired.";
  }

  if (subtotal < coupon.minSubtotal) {
    return `Minimum subtotal is ${coupon.minSubtotal} VND.`;
  }

  if (coupon.eligiblePaymentMethods && (!paymentMethod || !coupon.eligiblePaymentMethods.includes(paymentMethod))) {
    return `Coupon requires payment method: ${coupon.eligiblePaymentMethods.join(", ")}.`;
  }

  return undefined;
}

function invalidCoupon(code: string, reason: string): CouponResult {
  return {
    code,
    isApplied: false,
    discount: 0,
    reason
  };
}
