import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";
import { config } from "./config.js";
import { coupons } from "./data/coupons.js";
import { menuItems } from "./data/menu.js";
import { renderAdminDashboard, requireAdmin, updateAdminOrderStatus } from "./http/admin.js";
import { quoteRequestSchema, createOrderRequestSchema, updateOrderStatusRequestSchema } from "./http/schemas.js";
import { AppError } from "./lib/app-error.js";
import { processMessengerWebhook, verifyMetaSignature, type MetaWebhookPayload } from "./services/messenger.js";
import { createOrder, getOrder, listOrders, updateOrderStatus } from "./services/orders.js";
import { createQuote } from "./services/pricing.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(
    express.json({
      limit: "1mb",
      verify: (request, _response, buffer) => {
        (request as typeof request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      }
    })
  );
  app.use(express.urlencoded({ extended: false }));
  if (process.env.NODE_ENV !== "test") {
    app.use(morgan(redactedMorganFormat));
  }

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "kfc-tracks",
      timestamp: new Date().toISOString()
    });
  });

  app.get("/menu", (_request, response) => {
    response.json({
      items: menuItems,
      categories: [...new Set(menuItems.map((item) => item.category))]
    });
  });

  app.get("/coupons", (_request, response) => {
    response.json({
      coupons: coupons.map((coupon) => ({
        code: coupon.code,
        label: coupon.label,
        minSubtotal: coupon.minSubtotal,
        expiresAt: coupon.expiresAt,
        eligiblePaymentMethods: coupon.eligiblePaymentMethods ?? ["cod", "vnpay"]
      }))
    });
  });

  app.get("/admin", requireAdmin, (_request, response) => {
    response.type("html").send(renderAdminDashboard());
  });

  app.post("/admin/orders/:orderId/status", requireAdmin, (request, response, next) => {
    try {
      updateAdminOrderStatus(request, response);
    } catch (error) {
      next(error);
    }
  });

  app.get("/webhooks/meta", (request, response, next) => {
    try {
      const mode = request.query["hub.mode"];
      const token = request.query["hub.verify_token"];
      const challenge = request.query["hub.challenge"];

      if (mode === "subscribe" && token === config.meta.verifyToken && typeof challenge === "string") {
        response.status(200).send(challenge);
        return;
      }

      throw new AppError(403, "Meta webhook verification failed.");
    } catch (error) {
      next(error);
    }
  });

  app.post("/webhooks/meta", async (request, response, next) => {
    try {
      const rawBody = (request as typeof request & { rawBody?: Buffer }).rawBody;
      const signatureHeader = request.header("x-hub-signature-256");

      if (!verifyMetaSignature(rawBody, signatureHeader)) {
        throw new AppError(401, "Invalid Meta webhook signature.");
      }

      const result = await processMessengerWebhook(request.body as MetaWebhookPayload);
      response.json({
        ok: true,
        ...result
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/orders/quote", (request, response, next) => {
    try {
      const input = quoteRequestSchema.parse(request.body);
      response.json(createQuote(input));
    } catch (error) {
      next(error);
    }
  });

  app.post("/orders", (request, response, next) => {
    try {
      const input = createOrderRequestSchema.parse(request.body);
      response.status(201).json(createOrder(input));
    } catch (error) {
      next(error);
    }
  });

  app.get("/orders", (_request, response) => {
    response.json({
      orders: listOrders()
    });
  });

  app.get("/orders/:orderId", (request, response, next) => {
    try {
      const order = getOrder(request.params.orderId);

      if (!order) {
        throw new AppError(404, "Order not found.");
      }

      response.json(order);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/orders/:orderId/status", (request, response, next) => {
    try {
      const input = updateOrderStatusRequestSchema.parse(request.body);
      response.json(updateOrderStatus(request.params.orderId, input.status));
    } catch (error) {
      next(error);
    }
  });

  app.use((_request, _response, next) => {
    next(new AppError(404, "Route not found."));
  });

  app.use(errorHandler);

  return app;
}

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "ValidationError",
      message: "Request body is invalid.",
      details: error.issues
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: error.name,
      message: error.message,
      details: error.details
    });
    return;
  }

  response.status(500).json({
    error: "InternalServerError",
    message: "Unexpected server error."
  });
};

const redactedMorganFormat: morgan.FormatFn<express.Request, express.Response> = (tokens, request, response) => {
  const method = tokens.method(request, response) ?? "";
  const url = redactSensitiveUrl(tokens.url(request, response) ?? request.originalUrl);
  const status = tokens.status(request, response) ?? "";
  const responseTime = tokens["response-time"](request, response) ?? "";
  const contentLength = tokens.res(request, response, "content-length") ?? "-";

  return `${method} ${url} ${status} ${responseTime} ms - ${contentLength}`;
};

function redactSensitiveUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, "http://localhost");
    const sensitiveParams = ["hub.verify_token", "access_token", "token"];

    for (const param of sensitiveParams) {
      if (url.searchParams.has(param)) {
        url.searchParams.set(param, "[redacted]");
      }
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return rawUrl.replace(/(hub\.verify_token|access_token|token)=([^&\s]+)/g, "$1=[redacted]");
  }
}
