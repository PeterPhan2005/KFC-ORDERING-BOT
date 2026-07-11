import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { AppError } from "../lib/app-error.js";
import { listOrders, updateOrderStatus } from "../services/orders.js";
import type { Order, OrderStatus } from "../types.js";

const ORDER_STATUSES: OrderStatus[] = ["CONFIRMED_COD", "PENDING_PAYMENT", "PAID", "CANCELLED"];

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  if (!config.admin.password || config.admin.password === "change-me") {
    next(new AppError(503, "Admin password is not configured."));
    return;
  }

  const authorization = request.header("authorization");

  if (!authorization?.startsWith("Basic ")) {
    requestAdminAuth(response);
    return;
  }

  const credentials = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
  const separatorIndex = credentials.indexOf(":");
  const username = credentials.slice(0, separatorIndex);
  const password = credentials.slice(separatorIndex + 1);

  if (username !== config.admin.username || password !== config.admin.password) {
    requestAdminAuth(response);
    return;
  }

  next();
}

export function renderAdminDashboard(): string {
  const orders = listOrders();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KFC Tracks Admin</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f7f5;
      color: #191919;
    }
    body {
      margin: 0;
      background: #f7f7f5;
    }
    header {
      background: #b91c1c;
      color: #fff;
      padding: 18px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    h1 {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 24px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .metric {
      background: #fff;
      border: 1px solid #deded8;
      border-radius: 8px;
      padding: 14px;
    }
    .metric b {
      display: block;
      font-size: 22px;
      margin-top: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border: 1px solid #deded8;
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      padding: 12px;
      border-bottom: 1px solid #ecece7;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #f0f0eb;
      font-size: 12px;
      text-transform: uppercase;
      color: #555;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    code {
      font-size: 12px;
      word-break: break-all;
    }
    .items {
      margin: 0;
      padding-left: 16px;
    }
    form {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    select, button {
      border: 1px solid #c9c9c2;
      border-radius: 6px;
      min-height: 36px;
      padding: 0 10px;
      font: inherit;
      background: #fff;
    }
    button {
      background: #191919;
      color: #fff;
      cursor: pointer;
    }
    .empty {
      background: #fff;
      border: 1px solid #deded8;
      border-radius: 8px;
      padding: 18px;
    }
    @media (max-width: 760px) {
      main {
        padding: 16px;
      }
      table, thead, tbody, th, td, tr {
        display: block;
      }
      thead {
        display: none;
      }
      tr {
        border-bottom: 1px solid #deded8;
      }
      td {
        border-bottom: 0;
      }
      td::before {
        content: attr(data-label);
        display: block;
        color: #666;
        font-size: 12px;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>KFC Tracks Admin</h1>
    <span>${new Date().toLocaleString("vi-VN")}</span>
  </header>
  <main>
    ${renderSummary(orders)}
    ${orders.length > 0 ? renderOrdersTable(orders) : '<div class="empty">No orders yet.</div>'}
  </main>
</body>
</html>`;
}

export function updateAdminOrderStatus(request: Request, response: Response) {
  const status = String(request.body.status ?? "");

  if (!ORDER_STATUSES.includes(status as OrderStatus)) {
    throw new AppError(400, "Invalid order status.");
  }

  updateOrderStatus(String(request.params.orderId), status as OrderStatus);
  response.redirect(303, "/admin");
}

function renderSummary(orders: Order[]): string {
  const totalRevenue = orders.reduce((sum, order) => sum + order.quote.total, 0);
  const paidOrders = orders.filter((order) => order.status === "PAID").length;
  const pendingPayments = orders.filter((order) => order.status === "PENDING_PAYMENT").length;

  return `<section class="summary" aria-label="Order summary">
    <div class="metric">Orders<b>${orders.length}</b></div>
    <div class="metric">Revenue<b>${formatVnd(totalRevenue)}</b></div>
    <div class="metric">Paid<b>${paidOrders}</b></div>
    <div class="metric">Pending payment<b>${pendingPayments}</b></div>
  </section>`;
}

function renderOrdersTable(orders: Order[]): string {
  return `<table>
    <thead>
      <tr>
        <th>Order</th>
        <th>Customer</th>
        <th>Items</th>
        <th>Total</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${orders.map(renderOrderRow).join("")}
    </tbody>
  </table>`;
}

function renderOrderRow(order: Order): string {
  return `<tr>
    <td data-label="Order">
      <code>${escapeHtml(order.id)}</code><br>
      ${escapeHtml(order.paymentMethod.toUpperCase())}<br>
      ${escapeHtml(new Date(order.createdAt).toLocaleString("vi-VN"))}
    </td>
    <td data-label="Customer">
      ${escapeHtml(order.customer.name)}<br>
      ${escapeHtml(order.customer.phone)}<br>
      ${escapeHtml(order.customer.address)}
    </td>
    <td data-label="Items">
      <ul class="items">
        ${order.quote.items
          .map((item) => `<li>${escapeHtml(item.name)} x ${item.quantity}</li>`)
          .join("")}
      </ul>
    </td>
    <td data-label="Total">${formatVnd(order.quote.total)}</td>
    <td data-label="Status">
      <form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/status">
        <select name="status" aria-label="Order status">
          ${ORDER_STATUSES.map(
            (status) => `<option value="${status}" ${status === order.status ? "selected" : ""}>${status}</option>`
          ).join("")}
        </select>
        <button type="submit">Save</button>
      </form>
    </td>
  </tr>`;
}

function requestAdminAuth(response: Response) {
  response.setHeader("WWW-Authenticate", 'Basic realm="KFC Tracks Admin"');
  response.status(401).send("Authentication required.");
}

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
