import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
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
});
