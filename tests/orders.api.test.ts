import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { resetMenuForTest } from "../src/services/menu.js";
import { clearOrdersForTest } from "../src/services/orders.js";

const app = createApp();

const ZINGER_BURGER = "offline-burger-com-mi-y-burger-ga-zinger-4";
const COMBO_ZINGER = "offline-combo-1-nguoi-combo-burger-zinger-10";
const PEPSI = "offline-thuc-uong-trang-mieng-pepsi-tieu-chuan-3";

describe("orders API", () => {
  beforeEach(() => {
    clearOrdersForTest();
    resetMenuForTest();
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
    expect(response.body.items[0]).toHaveProperty("orderId");
  });

  it("lists the additional single-use coupons", async () => {
    const response = await request(app).get("/coupons").expect(200);
    const codes = response.body.coupons.map((coupon: { code: string }) => coupon.code);

    expect(codes).toContain("BURGER10");
    expect(codes).toContain("VNPAY25");
    expect(codes).toEqual(expect.arrayContaining(["SAVE10", "SAVE50", "SAVE100"]));
  });

  it("quotes an order", async () => {
    const response = await request(app)
      .post("/orders/quote")
      .send({
        items: [{ sku: ZINGER_BURGER, quantity: 2 }],
        couponCode: "FREESHIP"
      })
      .expect(200);

    expect(response.body.subtotal).toBe(112000);
    expect(response.body.total).toBe(112000);
    expect(response.body.coupon.isApplied).toBe(true);
  });

  it("creates a COD order as confirmed", async () => {
    const response = await request(app)
      .post("/orders")
      .send({
        items: [{ sku: ZINGER_BURGER, quantity: 1 }],
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
    expect(response.body.quote.total).toBe(76000);
  });

  it("creates a VNPay order as pending payment", async () => {
    const response = await request(app)
      .post("/orders")
      .send({
        items: [{ sku: COMBO_ZINGER, quantity: 1 }],
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
        items: [{ sku: COMBO_ZINGER, quantity: 1 }],
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
        items: [{ sku: COMBO_ZINGER, quantity: 1 }],
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

  it("marks a confirmed COD order as paid after cash collection", async () => {
    const createResponse = await request(app)
      .post("/orders")
      .send({
        items: [{ sku: COMBO_ZINGER, quantity: 1 }],
        paymentMethod: "cod",
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

  it("rejects invalid order status transitions", async () => {
    const createResponse = await request(app)
      .post("/orders")
      .send({
        items: [{ sku: COMBO_ZINGER, quantity: 1 }],
        paymentMethod: "cod",
        customer: {
          name: "Peter",
          phone: "0900000000",
          address: "123 Nguyen Trai, District 1, HCMC"
        }
      })
      .expect(201);

    const response = await request(app)
      .patch(`/orders/${createResponse.body.id}/status`)
      .send({ status: "CANCELLED" })
      .expect(409);

    expect(response.body.message).toContain("cannot transition");
  });

  it("deletes an order through the API", async () => {
    const beforeMenuResponse = await request(app).get("/menu").expect(200);
    const beforeStock = beforeMenuResponse.body.items.find(
      (item: { sku: string; stockQuantity: number }) => item.sku === COMBO_ZINGER
    ).stockQuantity;

    const createResponse = await request(app)
      .post("/orders")
      .send({
        items: [{ sku: COMBO_ZINGER, quantity: 1 }],
        paymentMethod: "cod",
        customer: {
          name: "Peter",
          phone: "0900000000",
          address: "123 Nguyen Trai, District 1, HCMC"
        }
      })
      .expect(201);

    await request(app).delete(`/orders/${createResponse.body.id}`).expect(204);

    await request(app).get(`/orders/${createResponse.body.id}`).expect(404);

    const afterMenuResponse = await request(app).get("/menu").expect(200);
    const afterStock = afterMenuResponse.body.items.find(
      (item: { sku: string; stockQuantity: number }) => item.sku === COMBO_ZINGER
    ).stockQuantity;

    expect(afterStock).toBe(beforeStock);
  });

  it("updates menu price and stock through the API", async () => {
    const updateResponse = await request(app)
      .patch(`/menu/${ZINGER_BURGER}`)
      .send({
        price: 62000,
        stockQuantity: 3,
        isAvailable: true
      })
      .expect(200);

    expect(updateResponse.body).toMatchObject({
      sku: ZINGER_BURGER,
      price: 62000,
      stockQuantity: 3,
      isAvailable: true
    });

    const quoteResponse = await request(app)
      .post("/orders/quote")
      .send({
        items: [{ sku: ZINGER_BURGER, quantity: 1 }]
      })
      .expect(200);

    expect(quoteResponse.body.subtotal).toBe(62000);
  });

  it("blocks orders that exceed current stock", async () => {
    await request(app)
      .patch(`/menu/${ZINGER_BURGER}`)
      .send({
        stockQuantity: 0,
        isAvailable: true
      })
      .expect(200);

    const response = await request(app)
      .post("/orders")
      .send({
        items: [{ sku: ZINGER_BURGER, quantity: 1 }],
        paymentMethod: "cod",
        customer: {
          name: "Peter",
          phone: "0900000000",
          address: "123 Nguyen Trai, District 1, HCMC"
        }
      })
      .expect(409);

    expect(response.body.message).toContain("only has 0 item");
  });

  it("renders the admin dashboard behind login", async () => {
    const agent = await loginAdmin();

    await request(app).get("/admin").expect(303);

    await request(app)
      .post("/orders")
      .send({
        items: [{ sku: COMBO_ZINGER, quantity: 1 }],
        paymentMethod: "cod",
        customer: {
          name: "Peter",
          phone: "0900000000",
          address: "123 Nguyen Trai, District 1, HCMC"
        }
      })
      .expect(201);

    const response = await agent
      .get("/admin")
      .expect(200);

    expect(response.text).toContain("KFC Tracks Admin");
    expect(response.text).toContain("Zinger Burger Combo");
    expect(response.text).toContain("Menu");
    expect(response.text).toContain("Revenue collected");
    expect(response.text).toContain("/admin/admin.js");
  });

  it("serves the admin realtime client script behind login", async () => {
    const agent = await loginAdmin();

    await request(app).get("/admin/admin.js").expect(401);

    const response = await agent
      .get("/admin/admin.js")
      .expect(200);

    expect(response.text).toContain("EventSource");
    expect(response.text).toContain("/admin/events");
  });

  it("updates store hours from the admin dashboard", async () => {
    const agent = await loginAdmin();

    await agent
      .post("/admin/store-hours")
      .send({ openHour: 8, closeHour: 22 })
      .expect(303);

    const response = await agent.get("/admin").expect(200);
    expect(response.text).toContain("Current hours: 08:00–22:00");
  });

  it("paginates orders in the admin dashboard", async () => {
    const agent = await loginAdmin();

    for (let index = 0; index < 9; index += 1) {
      await request(app)
        .post("/orders")
        .send({
          items: [{ sku: PEPSI, quantity: 1 }],
          paymentMethod: "cod",
          customer: {
            name: `Customer ${index}`,
            phone: "0900000000",
            address: "123 Nguyen Trai, District 1, HCMC"
          }
        })
        .expect(201);
    }

    const response = await agent
      .get("/admin?page=2")
      .expect(200);

    expect(response.text).toContain("Page 2 / 2");
    expect(response.text).toContain("Showing 1 of 9");
  });

  it("deletes an order from the admin dashboard", async () => {
    const agent = await loginAdmin();

    const createResponse = await request(app)
      .post("/orders")
      .send({
        items: [{ sku: PEPSI, quantity: 1 }],
        paymentMethod: "cod",
        customer: {
          name: "Delete Me",
          phone: "0900000000",
          address: "123 Nguyen Trai, District 1, HCMC"
        }
      })
      .expect(201);

    await agent
      .post(`/admin/orders/${createResponse.body.id}/delete`)
      .send({ page: "1" })
      .expect(303);

    const ordersResponse = await request(app).get("/orders").expect(200);
    expect(ordersResponse.body.orders).toHaveLength(0);
  });

  it("logs in and logs out of the admin dashboard", async () => {
    config.admin.username = "admin";
    config.admin.password = "secret";
    config.admin.sessionSecret = "session-secret";
    const agent = request.agent(app);

    const loginPage = await agent.get("/admin/login").expect(200);
    expect(loginPage.text).toContain("KFC Tracks Admin");
    expect(loginPage.text).toContain("Sign in");

    await agent
      .post("/admin/login")
      .send({
        username: "admin",
        password: "secret",
        next: "/admin"
      })
      .expect(303);

    await agent.get("/admin").expect(200);
    await agent.post("/admin/logout").expect(303);
    await agent.get("/admin").expect(303);
  });

  it("does not create a demo order from Telegram text a", async () => {
    config.telegram.webhookSecret = "telegram-test-secret";

    const response = await request(app)
      .post("/webhooks/telegram")
      .set("X-Telegram-Bot-Api-Secret-Token", "telegram-test-secret")
      .send({
        update_id: 1,
        message: {
          message_id: 10,
          text: "a",
          chat: {
            id: 123456,
            type: "private"
          },
          from: {
            id: 123456,
            username: "tester"
          }
        }
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      processedEvents: 1
    });
    expect(response.body.createdOrders).toHaveLength(0);

    const ordersResponse = await request(app).get("/orders").expect(200);
    expect(ordersResponse.body.orders).toHaveLength(0);
  });

  it("rejects Telegram webhook requests with an invalid secret", async () => {
    config.telegram.webhookSecret = "telegram-test-secret";

    await request(app)
      .post("/webhooks/telegram")
      .set("X-Telegram-Bot-Api-Secret-Token", "wrong-secret")
      .send({
        update_id: 1,
        message: {
          text: "a",
          chat: { id: 123456 }
        }
      })
      .expect(401);
  });

  it("renders the public dashboard at the root route", async () => {
    const response = await request(app).get("/").expect(200);

    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("KFC Tracks Dashboard");
    expect(response.text).toContain("Food ordering dashboard for VNPay review");
    expect(response.text).toContain("/payments/vnpay/ipn");
    expect(response.text).toContain("Featured Menu");
  });

  it("renders the public dashboard at /dashboard", async () => {
    const response = await request(app).get("/dashboard").expect(200);

    expect(response.text).toContain("KFC Tracks Dashboard");
    expect(response.text).toContain("VNPAY25");
  });

  it("lists available local endpoints at the API route", async () => {
    const response = await request(app).get("/api").expect(200);

    expect(response.body.endpoints).toMatchObject({
      dashboard: "/dashboard",
      health: "/health",
      admin: "/admin",
      telegramWebhook: "/webhooks/telegram",
      menu: "/menu",
      orders: "/orders"
    });
  });
});

async function loginAdmin() {
  config.admin.username = "admin";
  config.admin.password = "secret";
  config.admin.sessionSecret = "session-secret";

  const agent = request.agent(app);

  await agent
    .post("/admin/login")
    .send({
      username: "admin",
      password: "secret",
      next: "/admin"
    })
    .expect(303);

  return agent;
}
