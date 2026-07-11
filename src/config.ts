import "dotenv/config";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  database: {
    url: process.env.DATABASE_URL ?? "",
    ssl: process.env.DATABASE_SSL === "true"
  },
  admin: {
    username: process.env.ADMIN_USERNAME ?? "admin",
    password: process.env.ADMIN_PASSWORD ?? "",
    sessionSecret: process.env.ADMIN_SESSION_SECRET ?? ""
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? ""
  },
  vnpay: {
    tmnCode: process.env.VNPAY_TMN_CODE ?? "",
    hashSecret: process.env.VNPAY_HASH_SECRET ?? "",
    paymentUrl: process.env.VNPAY_PAYMENT_URL ?? "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
    returnUrl: process.env.VNPAY_RETURN_URL ?? `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/payments/vnpay/return`,
    ipnUrl: process.env.VNPAY_IPN_URL ?? `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/payments/vnpay/ipn`
  },
  store: {
    timezone: process.env.STORE_TIME_ZONE ?? "Asia/Ho_Chi_Minh",
    openHour: Number(process.env.STORE_OPEN_HOUR ?? 8),
    closeHour: Number(process.env.STORE_CLOSE_HOUR ?? 22)
  }
};
