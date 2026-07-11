import "dotenv/config";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000"
};
