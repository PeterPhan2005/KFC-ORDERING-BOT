import type { Coupon } from "../types.js";

const percentageSeedCoupons: Coupon[] = Array.from({ length: 10 }, (_, index) => {
  const percentage = (index + 1) * 10;

  return {
    code: `SAVE${percentage}`,
    label: `Discount ${percentage}% on food items`,
    type: "percentage",
    value: percentage,
    minSubtotal: 0,
    expiresAt: "2027-12-31T23:59:59.000Z",
    isActive: true
  };
});

export const coupons: Coupon[] = [
  {
    code: "KFC20",
    label: "20% off food orders from 120,000 VND",
    type: "percentage",
    value: 20,
    minSubtotal: 120000,
    maxDiscount: 50000,
    expiresAt: "2027-12-31T23:59:59.000Z",
    isActive: true
  },
  {
    code: "FREESHIP",
    label: "Free delivery",
    type: "free_shipping",
    value: 100,
    minSubtotal: 80000,
    expiresAt: "2027-12-31T23:59:59.000Z",
    isActive: true
  },
  {
    code: "COD15K",
    label: "15,000 VND off when paying by COD",
    type: "fixed",
    value: 15000,
    minSubtotal: 100000,
    expiresAt: "2027-12-31T23:59:59.000Z",
    eligiblePaymentMethods: ["cod"],
    isActive: true
  },
  {
    code: "BURGER10",
    label: "10,000 VND off orders from 90,000 VND",
    type: "fixed",
    value: 10000,
    minSubtotal: 90000,
    expiresAt: "2027-12-31T23:59:59.000Z",
    isActive: true
  },
  {
    code: "VNPAY25",
    label: "25% off up to 30,000 VND when paying by VNPay",
    type: "percentage",
    value: 25,
    minSubtotal: 120000,
    maxDiscount: 30000,
    expiresAt: "2027-12-31T23:59:59.000Z",
    eligiblePaymentMethods: ["vnpay"],
    isActive: true
  },
  ...percentageSeedCoupons
];

export const couponsByCode = new Map(coupons.map((coupon) => [coupon.code, coupon]));
