import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { resetMenuForTest } from "../src/services/menu.js";
import { clearOrdersForTest, createOrder } from "../src/services/orders.js";
import { createVnpayPaymentUrl, createVnpaySecureHash, verifyVnpayCallback } from "../src/services/vnpay.js";

const app = createApp();
const COMBO_ZINGER = "offline-combo-1-nguoi-combo-burger-zinger-10";

describe("VNPay sandbox integration", () => {
  beforeEach(() => {
    clearOrdersForTest();
    resetMenuForTest();
    config.vnpay.tmnCode = "TESTCODE";
    config.vnpay.hashSecret = "test-hash-secret";
    config.vnpay.paymentUrl = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
    config.vnpay.returnUrl = "https://example.com/api/v1/payment/vnpay-return";
    config.vnpay.ipnUrl = "https://example.com/api/v1/payment/vnpay-ipn";
    config.telegram.botUrl = "https://t.me/Cfc_Kfc_ordering_bot";
  });

  it("creates a signed payment URL with the order total", async () => {
    const order = await createVnpayOrder();
    const paymentUrl = new URL(createVnpayPaymentUrl(order, new Date("2026-07-11T05:00:00.000Z")));

    expect(paymentUrl.searchParams.get("vnp_TxnRef")).toBe(order.id);
    expect(paymentUrl.searchParams.get("vnp_Amount")).toBe(String(order.quote.total * 100));
    expect(paymentUrl.searchParams.get("vnp_ReturnUrl")).toBe("https://example.com/api/v1/payment/vnpay-return");
    expect(verifyVnpayCallback(Object.fromEntries(paymentUrl.searchParams))).toMatchObject({
      orderId: order.id,
      isValid: true
    });
  });

  it("marks an order paid from a valid successful IPN", async () => {
    const order = await createVnpayOrder();
    const params = {
      vnp_Amount: String(order.quote.total * 100),
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TxnRef: order.id
    };

    const response = await request(app)
      .get("/api/v1/payment/vnpay-ipn")
      .query({ ...params, vnp_SecureHash: createVnpaySecureHash(params) })
      .expect(200);

    expect(response.body).toEqual({ RspCode: "00", Message: "Confirm Success" });
    const ordersResponse = await request(app).get("/orders").expect(200);
    expect(ordersResponse.body.orders[0].status).toBe("PAID");
  });

  it("rejects an IPN with an invalid signature", async () => {
    const response = await request(app)
      .get("/payments/vnpay/ipn")
      .query({ vnp_TxnRef: "fake", vnp_SecureHash: "invalid" })
      .expect(200);

    expect(response.body.RspCode).toBe("97");
  });

  it("rejects a correctly signed IPN with the wrong amount", async () => {
    const order = await createVnpayOrder();
    const params = {
      vnp_Amount: String(order.quote.total * 100 + 100),
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TxnRef: order.id
    };

    const response = await request(app)
      .get("/payments/vnpay/ipn")
      .query({ ...params, vnp_SecureHash: createVnpaySecureHash(params) })
      .expect(200);

    expect(response.body.RspCode).toBe("04");
    const ordersResponse = await request(app).get("/orders").expect(200);
    expect(ordersResponse.body.orders[0].status).toBe("PENDING_PAYMENT");
  });

  it("redirects a valid successful VNPay return back to the Telegram bot", async () => {
    const order = await createVnpayOrder();
    const params = {
      vnp_Amount: String(order.quote.total * 100),
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TxnRef: order.id
    };

    const response = await request(app)
      .get("/api/v1/payment/vnpay-return")
      .query({ ...params, vnp_SecureHash: createVnpaySecureHash(params) })
      .expect(303);

    expect(response.header.location).toBe(`https://t.me/Cfc_Kfc_ordering_bot?start=vnpay_paid_${order.id}`);
    const ordersResponse = await request(app).get("/orders").expect(200);
    expect(ordersResponse.body.orders[0].status).toBe("PAID");
  });

  it("redirects a valid failed VNPay return back to the Telegram bot without marking paid", async () => {
    const order = await createVnpayOrder();
    const params = {
      vnp_Amount: String(order.quote.total * 100),
      vnp_ResponseCode: "24",
      vnp_TransactionStatus: "02",
      vnp_TxnRef: order.id
    };

    const response = await request(app)
      .get("/payments/vnpay/return")
      .query({ ...params, vnp_SecureHash: createVnpaySecureHash(params) })
      .expect(303);

    expect(response.header.location).toBe(`https://t.me/Cfc_Kfc_ordering_bot?start=vnpay_failed_${order.id}`);
    const ordersResponse = await request(app).get("/orders").expect(200);
    expect(ordersResponse.body.orders[0].status).toBe("PENDING_PAYMENT");
  });

  it("shows an error page for an invalid VNPay return signature", async () => {
    const response = await request(app)
      .get("/payments/vnpay/return")
      .query({ vnp_TxnRef: "fake", vnp_SecureHash: "invalid" })
      .expect(400);

    expect(response.text).toContain("Payment result could not be verified");
    expect(response.text).toContain("https://t.me/Cfc_Kfc_ordering_bot");
  });

  it("handles duplicate successful IPN callbacks idempotently", async () => {
    const order = await createVnpayOrder();
    const params = {
      vnp_Amount: String(order.quote.total * 100),
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TxnRef: order.id
    };
    const query = { ...params, vnp_SecureHash: createVnpaySecureHash(params) };

    await request(app).get("/payments/vnpay/ipn").query(query).expect(200);
    const duplicateResponse = await request(app).get("/payments/vnpay/ipn").query(query).expect(200);

    expect(duplicateResponse.body.RspCode).toBe("00");
    const ordersResponse = await request(app).get("/orders").expect(200);
    expect(ordersResponse.body.orders).toHaveLength(1);
    expect(ordersResponse.body.orders[0].status).toBe("PAID");
  });
});

async function createVnpayOrder() {
  return createOrder({
    items: [{ sku: COMBO_ZINGER, quantity: 1 }],
    paymentMethod: "vnpay",
    customer: {
      name: "Peter",
      phone: "0900000000",
      address: "123 Nguyen Trai, District 1, HCMC"
    }
  });
}
