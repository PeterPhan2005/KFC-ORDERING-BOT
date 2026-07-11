import { isDatabaseEnabled, queryDatabase } from "../lib/database.js";

const redeemedCouponCodes = new Set<string>();

export async function initializeCouponRedemptions(): Promise<void> {
  if (!isDatabaseEnabled()) {
    return;
  }

  const result = await queryDatabase<{ coupon_code: string }>("SELECT coupon_code FROM coupon_redemptions");
  redeemedCouponCodes.clear();
  result.rows.forEach((row) => redeemedCouponCodes.add(row.coupon_code));
}

export function isCouponRedeemed(code: string): boolean {
  return redeemedCouponCodes.has(code.toUpperCase());
}

export async function redeemCoupon(code: string, orderId: string): Promise<boolean> {
  const normalizedCode = code.toUpperCase();

  if (redeemedCouponCodes.has(normalizedCode)) {
    return false;
  }

  if (isDatabaseEnabled()) {
    const result = await queryDatabase(
      "INSERT INTO coupon_redemptions (coupon_code, order_id, redeemed_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING RETURNING coupon_code",
      [normalizedCode, orderId]
    );

    if (result.rowCount !== 1) {
      return false;
    }
  }

  redeemedCouponCodes.add(normalizedCode);
  return true;
}

export async function releaseCouponRedemption(code: string, orderId: string): Promise<void> {
  const normalizedCode = code.toUpperCase();

  if (isDatabaseEnabled()) {
    await queryDatabase("DELETE FROM coupon_redemptions WHERE coupon_code = $1 AND order_id = $2", [normalizedCode, orderId]);
  }

  redeemedCouponCodes.delete(normalizedCode);
}

export function clearCouponRedemptionsForTest() {
  redeemedCouponCodes.clear();
}
