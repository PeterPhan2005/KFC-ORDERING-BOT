CREATE TABLE IF NOT EXISTS coupon_redemptions (
  coupon_code TEXT PRIMARY KEY,
  order_id UUID NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL
);
