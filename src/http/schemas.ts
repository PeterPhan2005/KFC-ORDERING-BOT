import { z } from "zod";

const orderItemSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  quantity: z.number().int().min(1).max(20)
});

export const quoteRequestSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(25),
  couponCode: z.string().trim().min(1).max(32).optional(),
  paymentMethod: z.enum(["cod", "vnpay"]).optional(),
  deliveryAddress: z.string().trim().min(5).max(300).optional()
});

export const createOrderRequestSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(25),
  couponCode: z.string().trim().min(1).max(32).optional(),
  paymentMethod: z.enum(["cod", "vnpay"]),
  customer: z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().regex(/^(0|\+84)[0-9]{8,10}$/, "Invalid Vietnamese phone number."),
    address: z.string().trim().min(5).max(300)
  }),
  notes: z.string().trim().max(500).optional()
});

export const updateOrderStatusRequestSchema = z.object({
  status: z.enum(["CONFIRMED_COD", "PENDING_PAYMENT", "PAID", "CANCELLED"])
});

export const updateMenuItemRequestSchema = z.object({
  price: z.number().int().min(0).max(10000000).optional(),
  stockQuantity: z.number().int().min(0).max(100000).optional(),
  isAvailable: z.boolean().optional()
});

export const updateStoreHoursRequestSchema = z.object({
  openHour: z.coerce.number().int().min(0).max(23),
  closeHour: z.coerce.number().int().min(0).max(23)
});
