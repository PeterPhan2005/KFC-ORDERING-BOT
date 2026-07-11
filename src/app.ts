import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { join } from "node:path";
import { cwd } from "node:process";
import { ZodError } from "zod";
import { coupons } from "./data/coupons.js";
import { menuCategories } from "./data/menu.js";
import {
  deleteAdminOrder,
  handleAdminLogin,
  handleAdminLogout,
  isAdminAuthenticated,
  renderAdminClientScript,
  renderAdminDashboard,
  renderAdminLogin,
  requireAdmin,
  streamAdminEvents,
  updateAdminMenuItem,
  updateAdminOrderStatus,
  updateAdminStoreHours
} from "./http/admin.js";
import {
  quoteRequestSchema,
  createOrderRequestSchema,
  updateMenuItemRequestSchema,
  updateOrderStatusRequestSchema,
  updateStoreHoursRequestSchema
} from "./http/schemas.js";
import { AppError } from "./lib/app-error.js";
import { listMenuItems, updateMenuItem } from "./services/menu.js";
import { createOrder, deleteOrder, getOrder, listOrders, updateOrderStatus } from "./services/orders.js";
import { createQuote } from "./services/pricing.js";
import { createVnpayPaymentUrl, verifyVnpayCallback } from "./services/vnpay.js";
import {
  isTelegramWebhookAuthorized,
  processTelegramWebhook,
  type TelegramUpdate
} from "./services/telegram.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use("/assets", express.static(join(cwd(), "assets")));
  app.use(express.json({ limit: "1mb" }));
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

  app.get("/", (_request, response) => {
    response.json({
      ok: true,
      service: "kfc-tracks",
      endpoints: {
        health: "/health",
        admin: "/admin",
        telegramWebhook: "/webhooks/telegram",
        menu: "/menu",
        orders: "/orders"
      }
    });
  });

  app.get("/menu", (_request, response) => {
    const menuItems = listMenuItems();

    response.json({
      items: menuItems,
      categories: menuCategories
    });
  });

  app.patch("/menu/:sku", (request, response, next) => {
    try {
      const input = updateMenuItemRequestSchema.parse(request.body);
      response.json(updateMenuItem(String(request.params.sku), input));
    } catch (error) {
      next(error);
    }
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

  app.get("/admin/login", (request, response) => {
    if (isAdminAuthenticated(request)) {
      response.redirect(303, "/admin");
      return;
    }

    response.type("html").send(renderAdminLogin(undefined, String(request.query.next ?? "/admin")));
  });

  app.post("/admin/login", (request, response, next) => {
    try {
      handleAdminLogin(request, response);
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/logout", requireAdmin, (request, response) => {
    handleAdminLogout(request, response);
  });

  app.get("/admin", requireAdmin, async (request, response, next) => {
    try {
      response.type("html").send(await renderAdminDashboard(request.query.page));
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/admin.js", requireAdmin, (_request, response) => {
    response.type("application/javascript").send(renderAdminClientScript());
  });

  app.get("/admin/events", requireAdmin, (request, response) => {
    streamAdminEvents(request, response);
  });

  app.post("/admin/orders/:orderId/status", requireAdmin, async (request, response, next) => {
    try {
      await updateAdminOrderStatus(request, response);
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/orders/:orderId/delete", requireAdmin, async (request, response, next) => {
    try {
      await deleteAdminOrder(request, response);
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/menu/:sku", requireAdmin, (request, response, next) => {
    try {
      updateAdminMenuItem(request, response);
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/store-hours", requireAdmin, (request, response, next) => {
    try {
      const input = updateStoreHoursRequestSchema.parse(request.body);
      updateAdminStoreHours(request, response, input);
    } catch (error) {
      next(error);
    }
  });

  app.post("/webhooks/telegram", async (request, response, next) => {
    try {
      const secretHeader = request.header("x-telegram-bot-api-secret-token");

      if (!isTelegramWebhookAuthorized(secretHeader)) {
        throw new AppError(401, "Invalid Telegram webhook secret.");
      }

      const result = await processTelegramWebhook(request.body as TelegramUpdate);

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

  app.post("/orders", async (request, response, next) => {
    try {
      const input = createOrderRequestSchema.parse(request.body);
      response.status(201).json(await createOrder(input));
    } catch (error) {
      next(error);
    }
  });

  app.get("/payments/vnpay/orders/:orderId", async (request, response, next) => {
    try {
      const order = await getOrder(request.params.orderId);

      if (!order) {
        throw new AppError(404, "Order not found.");
      }

      response.redirect(303, createVnpayPaymentUrl(order, new Date(), request.ip ?? "127.0.0.1"));
    } catch (error) {
      next(error);
    }
  });

  app.get("/payments/vnpay/return", async (request, response, next) => {
    try {
      const result = verifyVnpayCallback(request.query);
      const order = result.orderId ? await getOrder(result.orderId) : undefined;
      const amountMatches = order && String(order.quote.total * 100) === String(request.query.vnp_Amount ?? "");

      response.status(result.isValid && amountMatches ? 200 : 400).json({
        ok: Boolean(result.isValid && amountMatches),
        paid: Boolean(result.isValid && amountMatches && result.isSuccessfulPayment),
        orderId: result.orderId
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/payments/vnpay/ipn", async (request, response) => {
    try {
      const result = verifyVnpayCallback(request.query);

      if (!result.isValid) {
        response.json({ RspCode: "97", Message: "Invalid signature" });
        return;
      }

      const order = await getOrder(result.orderId);

      if (!order) {
        response.json({ RspCode: "01", Message: "Order not found" });
        return;
      }

      if (String(order.quote.total * 100) !== String(request.query.vnp_Amount ?? "")) {
        response.json({ RspCode: "04", Message: "Invalid amount" });
        return;
      }

      if (result.isSuccessfulPayment && order.status !== "PAID") {
        await updateOrderStatus(order.id, "PAID");
      }

      response.json({ RspCode: "00", Message: "Confirm Success" });
    } catch (error) {
      console.error("VNPay IPN processing failed.", error);
      response.json({ RspCode: "99", Message: "Unknown error" });
    }
  });

  app.get("/orders", async (_request, response, next) => {
    try {
      response.json({ orders: await listOrders() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/orders/:orderId", async (request, response, next) => {
    try {
      const order = await getOrder(request.params.orderId);

      if (!order) {
        throw new AppError(404, "Order not found.");
      }

      response.json(order);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/orders/:orderId/status", async (request, response, next) => {
    try {
      const input = updateOrderStatusRequestSchema.parse(request.body);
      response.json(await updateOrderStatus(request.params.orderId, input.status));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/orders/:orderId", async (request, response, next) => {
    try {
      await deleteOrder(request.params.orderId);
      response.status(204).send();
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
    const sensitiveParams = ["access_token", "token", "secret", "webhook_secret"];

    for (const param of sensitiveParams) {
      if (url.searchParams.has(param)) {
        url.searchParams.set(param, "[redacted]");
      }
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return rawUrl.replace(/(access_token|token|secret|webhook_secret)=([^&\s]+)/g, "$1=[redacted]");
  }
}
