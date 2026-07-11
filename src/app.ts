import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";
import { coupons } from "./data/coupons.js";
import { menuItems } from "./data/menu.js";
import { quoteRequestSchema, createOrderRequestSchema, updateOrderStatusRequestSchema } from "./http/schemas.js";
import { AppError } from "./lib/app-error.js";
import { createOrder, getOrder, listOrders, updateOrderStatus } from "./services/orders.js";
import { createQuote } from "./services/pricing.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  if (process.env.NODE_ENV !== "test") {
    app.use(morgan("dev"));
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
