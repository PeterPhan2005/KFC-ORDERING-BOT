import "dotenv/config";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  admin: {
    username: process.env.ADMIN_USERNAME ?? "admin",
    password: process.env.ADMIN_PASSWORD ?? ""
  },
  meta: {
    verifyToken: process.env.META_VERIFY_TOKEN ?? "",
    pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
    graphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v23.0"
  }
};
