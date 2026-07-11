import { createHmac } from "node:crypto";
import { config } from "../config.js";
import { AppError } from "../lib/app-error.js";
import type { Order } from "../types.js";

export type VnpayIpnResult = {
  orderId: string;
  isValid: boolean;
  isSuccessfulPayment: boolean;
};

export function createVnpayPaymentUrl(order: Order, now = new Date(), ipAddress = "127.0.0.1"): string {
  assertVnpayConfigured();

  if (order.paymentMethod !== "vnpay" || order.status !== "PENDING_PAYMENT") {
    throw new AppError(409, "Order is not awaiting VNPay payment.");
  }

  const params: Record<string, string> = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: config.vnpay.tmnCode,
    vnp_Amount: String(order.quote.total * 100),
    vnp_CurrCode: "VND",
    vnp_TxnRef: order.id,
    vnp_OrderInfo: `KFC Tracks order ${order.id}`,
    vnp_OrderType: "other",
    vnp_Locale: "vn",
    vnp_ReturnUrl: config.vnpay.returnUrl,
    vnp_IpAddr: ipAddress,
    vnp_CreateDate: formatVnpayDate(now),
    vnp_ExpireDate: formatVnpayDate(new Date(now.getTime() + 15 * 60 * 1000))
  };
  const secureHash = createVnpaySecureHash(params);
  const query = new URLSearchParams({ ...sortVnpayParams(params), vnp_SecureHash: secureHash });

  return `${config.vnpay.paymentUrl}?${query.toString()}`;
}

export function verifyVnpayCallback(query: Record<string, unknown>): VnpayIpnResult {
  assertVnpayConfigured();
  const receivedHash = typeof query.vnp_SecureHash === "string" ? query.vnp_SecureHash : "";
  const params = Object.fromEntries(
    Object.entries(query)
      .filter(([key, value]) => key !== "vnp_SecureHash" && key !== "vnp_SecureHashType" && typeof value === "string")
      .map(([key, value]) => [key, value as string])
  );
  const orderId = params.vnp_TxnRef ?? "";

  return {
    orderId,
    isValid: Boolean(receivedHash) && safeEqual(createVnpaySecureHash(params), receivedHash),
    isSuccessfulPayment: params.vnp_ResponseCode === "00" && params.vnp_TransactionStatus === "00"
  };
}

function assertVnpayConfigured() {
  if (!config.vnpay.tmnCode || !config.vnpay.hashSecret || config.vnpay.tmnCode === "replace-me" || config.vnpay.hashSecret === "replace-me") {
    throw new AppError(503, "VNPay sandbox is not configured.");
  }
}

export function createVnpaySecureHash(params: Record<string, string>): string {
  return createHmac("sha512", config.vnpay.hashSecret).update(new URLSearchParams(sortVnpayParams(params)).toString()).digest("hex");
}

function sortVnpayParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).sort(([left], [right]) => left.localeCompare(right)));
}

function formatVnpayDate(value: Date): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

function safeEqual(left: string, right: string): boolean {
  return left.length === right.length && left === right;
}
