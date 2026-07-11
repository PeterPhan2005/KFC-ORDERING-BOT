import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { clearOrdersForTest } from "../src/services/orders.js";

const app = createApp();

describe("orders API", () => {
  beforeEach(() => {
    clearOrdersForTest();
  });

  it("returns health status", async () => {
    const response = await request(app).get("/health").expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      service: "kfc-tracks"
    });
  });

  it("returns menu items", async () => {
    const response = await request(app).get("/menu").expect(200);

    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0]).toHaveProperty("sku");
  });

  it("quotes an order", async () => {
    const response = await request(app)
      .post("/orders/quote")
      .send({
        items: [{ sku: "ZINGER_BURGER", quantity: 2 }],
        couponCode: "FREESHIP"
      })
      .expect(200);

    expect(response.body.subtotal).toBe(110000);
    expect(response.body.total).toBe(110000);
    expect(response.body.coupon.isApplied).toBe(true);
  });

  it("creates a COD order as confirmed", async () => {
    const response = await request(app)
      .post("/orders")
      .send({
        items: [{ sku: "ZINGER_BURGER", quantity: 1 }],
        paymentMethod: "cod",
        customer: {
          name: "Peter",
          phone: "0900000000",
          address: "123 Nguyen Trai, District 1, HCMC"
        }
      })
      .expect(201);

    expect(response.body.status).toBe("CONFIRMED_COD");
    expect(response.body.paymentMethod).toBe("cod");
    expect(response.body.quote.total).toBe(73000);
  });

  it("creates a VNPay order as pending payment", async () => {
    const response = await request(app)
      .post("/orders")
      .send({
        items: [{ sku: "COMBO_ZINGER", quantity: 1 }],
        paymentMethod: "vnpay",
        customer: {
          name: "Peter",
          phone: "+84900000000",
          address: "123 Nguyen Trai, District 1, HCMC"
        }
      })
      .expect(201);

    expect(response.body.status).toBe("PENDING_PAYMENT");
    expect(response.body.paymentMethod).toBe("vnpay");
  });

  it("validates customer phone number", async () => {
    const response = await request(app)
      .post("/orders")
      .send({
        items: [{ sku: "COMBO_ZINGER", quantity: 1 }],
        paymentMethod: "cod",
        customer: {
          name: "Peter",
          phone: "abc",
          address: "123 Nguyen Trai, District 1, HCMC"
        }
      })
      .expect(400);

    expect(response.body.error).toBe("ValidationError");
  });

  it("updates order status for fake operations", async () => {
    const createResponse = await request(app)
      .post("/orders")
      .send({
        items: [{ sku: "COMBO_ZINGER", quantity: 1 }],
        paymentMethod: "vnpay",
        customer: {
          name: "Peter",
          phone: "0900000000",
          address: "123 Nguyen Trai, District 1, HCMC"
        }
      })
      .expect(201);

    const updateResponse = await request(app)
      .patch(`/orders/${createResponse.body.id}/status`)
      .send({ status: "PAID" })
      .expect(200);

    expect(updateResponse.body.status).toBe("PAID");
  });

  it("renders the admin dashboard behind basic auth", async () => {
    config.admin.username = "admin";
    config.admin.password = "secret";

    await request(app).get("/admin").expect(401);

    await request(app)
      .post("/orders")
      .send({
        items: [{ sku: "COMBO_ZINGER", quantity: 1 }],
        paymentMethod: "cod",
        customer: {
          name: "Peter",
          phone: "0900000000",
          address: "123 Nguyen Trai, District 1, HCMC"
        }
      })
      .expect(201);

    const response = await request(app)
      .get("/admin")
      .auth("admin", "secret")
      .expect(200);

    expect(response.text).toContain("KFC Tracks Admin");
    expect(response.text).toContain("Combo Zinger");
  });

  it("verifies Meta webhook callback requests", async () => {
    const response = await request(app)
      .get("/webhooks/meta")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": config.meta.verifyToken,
        "hub.challenge": "challenge-123"
      })
      .expect(200);

    expect(response.text).toBe("challenge-123");
  });

  it("creates a smoke-test order from Messenger text a", async () => {
    const payload = {
      object: "page",
      entry: [
        {
          id: "page-id",
          time: Date.now(),
          messaging: [
            {
              sender: { id: "user-123456" },
              message: {
                mid: "mid-1",
                text: "a"
              }
            }
          ]
        }
      ]
    };
    const rawPayload = JSON.stringify(payload);

    const response = await request(app)
      .post("/webhooks/meta")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", createMetaSignature(rawPayload))
      .send(rawPayload)
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      processedEvents: 1
    });
    expect(response.body.createdOrders).toHaveLength(1);

    const ordersResponse = await request(app).get("/orders").expect(200);
    expect(ordersResponse.body.orders[0]).toMatchObject({
      status: "CONFIRMED_COD",
      paymentMethod: "cod"
    });
  });
});

function createMetaSignature(rawBody: string): string {
  if (!config.meta.appSecret || config.meta.appSecret === "replace-me") {
    return "sha256=test";
  }

  return `sha256=${createHmac("sha256", config.meta.appSecret).update(rawBody).digest("hex")}`;
}
