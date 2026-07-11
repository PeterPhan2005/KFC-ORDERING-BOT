import "dotenv/config";

const llmProvider = process.env.LLM_PROVIDER ?? (process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY ? "qwen" : "openai");
const defaultLlmBaseUrl =
  llmProvider === "qwen" ? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" : "https://api.openai.com/v1";
const defaultLlmModel = llmProvider === "qwen" ? "qwen-plus" : "gpt-4o-mini";
const providerApiKey =
  llmProvider === "qwen"
    ? process.env.QWEN_API_KEY ?? process.env.DASHSCOPE_API_KEY ?? ""
    : process.env.OPENAI_API_KEY ?? "";

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
  llm: {
    provider: llmProvider,
    apiKey: process.env.LLM_API_KEY ?? providerApiKey,
    baseUrl: (process.env.LLM_BASE_URL ?? process.env.QWEN_BASE_URL ?? defaultLlmBaseUrl).replace(/\/$/, ""),
    model: process.env.LLM_MODEL ?? process.env.QWEN_MODEL ?? process.env.OPENAI_MODEL ?? defaultLlmModel,
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 8000)
  },
  store: {
    timezone: process.env.STORE_TIME_ZONE ?? "Asia/Ho_Chi_Minh",
    openHour: Number(process.env.STORE_OPEN_HOUR ?? 8),
    closeHour: Number(process.env.STORE_CLOSE_HOUR ?? 22)
  }
};
