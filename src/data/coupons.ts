import type { Coupon } from "../types.js";

export const coupons: Coupon[] = [
  {
    code: "KFC20",
    label: "Giam 20% cho don tu 120.000d",
    type: "percentage",
    value: 20,
    minSubtotal: 120000,
    maxDiscount: 50000,
    expiresAt: "2027-12-31T23:59:59.000Z",
    isActive: true
  },
  {
    code: "FREESHIP",
    label: "Mien phi giao hang",
    type: "free_shipping",
    value: 100,
    minSubtotal: 80000,
    expiresAt: "2027-12-31T23:59:59.000Z",
    isActive: true
  },
  {
    code: "COD15K",
    label: "Giam 15.000d khi thanh toan COD",
    type: "fixed",
    value: 15000,
    minSubtotal: 100000,
    expiresAt: "2027-12-31T23:59:59.000Z",
    eligiblePaymentMethods: ["cod"],
    isActive: true
  }
];

export const couponsByCode = new Map(coupons.map((coupon) => [coupon.code, coupon]));
