import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { AppError } from "../lib/app-error.js";
import { subscribeAdminEvents } from "../services/admin-events.js";
import { listMenuItems, updateMenuItem } from "../services/menu.js";
import { deleteOrder, getSelectableOrderStatuses, listOrders, updateOrderStatus } from "../services/orders.js";
import { getStoreHours, updateStoreHours } from "../services/store.js";
import type { MenuItem, Order, OrderStatus } from "../types.js";

const ORDER_STATUSES: OrderStatus[] = ["CONFIRMED_COD", "PENDING_PAYMENT", "PAID", "CANCELLED"];
const ORDERS_PER_PAGE = 8;
const ADMIN_SESSION_COOKIE = "kfc_admin_session";
const ADMIN_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  if (!config.admin.password || config.admin.password === "change-me") {
    next(new AppError(503, "Admin password is not configured."));
    return;
  }

  if (isAdminAuthenticated(request)) {
    next();
    return;
  }

  requestAdminAuth(request, response);
}

export function isAdminAuthenticated(request: Request): boolean {
  const token = parseCookies(request.header("cookie"))[ADMIN_SESSION_COOKIE];

  return Boolean(token && verifyAdminSessionToken(token));
}

export function renderAdminLogin(errorMessage?: string, nextPath = "/admin"): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KFC Tracks Login</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f6f4;
      color: #181818;
    }
    * {
      box-sizing: border-box;
    }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      background:
        linear-gradient(rgba(24, 24, 24, 0.52), rgba(24, 24, 24, 0.52)),
        url("/assets/image/about-kfc.png") center / cover no-repeat,
        #b91c1c;
      padding: 24px;
    }
    .login-shell {
      width: min(100%, 420px);
      background: #fff;
      border: 1px solid #deded8;
      border-radius: 8px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.22);
      overflow: hidden;
    }
    .login-header {
      background: #b91c1c;
      color: #fff;
      padding: 22px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .login-header p {
      margin: 8px 0 0;
      color: rgba(255, 255, 255, 0.86);
      font-size: 14px;
    }
    form {
      display: grid;
      gap: 14px;
      padding: 22px;
    }
    label {
      display: grid;
      gap: 6px;
      color: #555;
      font-size: 12px;
      text-transform: uppercase;
    }
    input, button {
      border: 1px solid #c9c9c2;
      border-radius: 6px;
      min-height: 42px;
      padding: 0 12px;
      font: inherit;
      background: #fff;
    }
    button {
      margin-top: 4px;
      background: #181818;
      border-color: #181818;
      color: #fff;
      cursor: pointer;
    }
    .error {
      margin: 0;
      border: 1px solid #f2b8b5;
      background: #fff0ef;
      color: #a32020;
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 14px;
    }
    .hint {
      margin: 0;
      color: #666;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <section class="login-shell" aria-labelledby="login-title">
    <div class="login-header">
      <h1 id="login-title">KFC Tracks Admin</h1>
      <p>Sign in to manage orders, menu, and live bot traffic.</p>
    </div>
    <form method="post" action="/admin/login">
      <input type="hidden" name="next" value="${escapeHtml(safeAdminPath(nextPath))}">
      ${errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : ""}
      <label>
        Username
        <input name="username" autocomplete="username" required autofocus>
      </label>
      <label>
        Password
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit">Sign in</button>
      <p class="hint">Session lasts 12 hours on this browser.</p>
    </form>
  </section>
</body>
</html>`;
}

export function handleAdminLogin(request: Request, response: Response) {
  if (!config.admin.password || config.admin.password === "change-me") {
    throw new AppError(503, "Admin password is not configured.");
  }

  const username = String(request.body.username ?? "");
  const password = String(request.body.password ?? "");
  const nextPath = safeAdminPath(String(request.body.next ?? "/admin"));

  if (username !== config.admin.username || password !== config.admin.password) {
    response.status(401).type("html").send(renderAdminLogin("Invalid username or password.", nextPath));
    return;
  }

  response.cookie(ADMIN_SESSION_COOKIE, createAdminSessionToken(username), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    maxAge: ADMIN_SESSION_MAX_AGE_MS,
    path: "/admin"
  });

  response.redirect(303, nextPath);
}

export function handleAdminLogout(_request: Request, response: Response) {
  response.clearCookie(ADMIN_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/admin"
  });
  response.redirect(303, "/admin/login");
}

export async function renderAdminDashboard(pageInput: unknown): Promise<string> {
  const orders = await listOrders();
  const menuItems = listMenuItems();
  const storeHours = getStoreHours();
  const pagination = paginateOrders(orders, pageInput);

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
      background: #f6f6f4;
      color: #181818;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      background: #f6f6f4;
    }
    header {
      background: #b91c1c;
      color: #fff;
      padding: 18px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    h1, h2 {
      margin: 0;
      letter-spacing: 0;
    }
    h1 {
      font-size: 20px;
      line-height: 1.2;
    }
    h2 {
      font-size: 18px;
    }
    main {
      max-width: 1220px;
      margin: 0 auto;
      padding: 24px;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .metric, .panel {
      background: #fff;
      border: 1px solid #deded8;
      border-radius: 8px;
    }
    .metric {
      padding: 14px;
    }
    .metric b {
      display: block;
      font-size: 22px;
      margin-top: 4px;
    }
    .panel {
      margin-bottom: 18px;
      overflow: hidden;
    }
    .panel-header {
      min-height: 56px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid #ecece7;
      flex-wrap: wrap;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
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
    form.inline {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    label.field {
      display: grid;
      gap: 4px;
      color: #555;
      font-size: 12px;
      text-transform: uppercase;
    }
    input, select, button {
      border: 1px solid #c9c9c2;
      border-radius: 6px;
      min-height: 36px;
      padding: 0 10px;
      font: inherit;
      background: #fff;
    }
    input[type="number"] {
      width: 120px;
    }
    input[type="checkbox"] {
      min-height: 18px;
      width: 18px;
      padding: 0;
      accent-color: #b91c1c;
    }
    button {
      background: #181818;
      color: #fff;
      cursor: pointer;
      border-color: #181818;
      white-space: nowrap;
    }
    .danger-button {
      background: #fff;
      border-color: #b91c1c;
      color: #b91c1c;
    }
    .ghost-button {
      background: #fff;
      color: #181818;
    }
    .actions {
      display: grid;
      gap: 8px;
      align-items: start;
    }
    .pager {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-top: 1px solid #ecece7;
      flex-wrap: wrap;
    }
    .pager a, .pager .disabled {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      padding: 0 12px;
      border-radius: 6px;
      border: 1px solid #c9c9c2;
      text-decoration: none;
      color: #181818;
      background: #fff;
    }
    .pager .disabled {
      color: #9b9b93;
      background: #f7f7f3;
    }
    .pager-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 0 8px;
      border-radius: 999px;
      border: 1px solid #d7d7d0;
      font-size: 12px;
      background: #f8f8f4;
    }
    .status.ok {
      border-color: #78b77b;
      color: #12621b;
      background: #eef8ee;
    }
    .status.warn {
      border-color: #d8b85b;
      color: #775600;
      background: #fff8df;
    }
    .empty {
      padding: 18px;
    }
    .muted {
      color: #666;
      font-size: 13px;
    }
    .sku {
      font-weight: 700;
    }
    .menu-item-cell {
      display: grid;
      grid-template-columns: 72px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
    }
    .menu-thumb {
      width: 72px;
      height: 72px;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid #ecece7;
      background: #f6f6f4;
    }
    .realtime-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 28px;
      padding: 0 8px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.5);
      color: #fff;
      font-size: 12px;
    }
    .realtime-indicator::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #facc15;
    }
    .realtime-indicator.connected::before {
      background: #86efac;
    }
    .realtime-indicator.reconnecting::before {
      background: #fdba74;
    }
    @media (max-width: 780px) {
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
      input[type="number"] {
        width: 100%;
      }
      form.inline {
        align-items: stretch;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>KFC Tracks Admin</h1>
    <span class="realtime-indicator" id="realtime-status">Realtime connecting</span>
    <form class="inline" method="post" action="/admin/logout">
      <button class="ghost-button" type="submit">Logout</button>
    </form>
    <span>${escapeHtml(new Date().toLocaleString("vi-VN"))}</span>
  </header>
  <main>
    <div class="topbar">
      <span class="muted">Local in-memory dashboard. Restart server se reset orders va menu edits.</span>
    </div>
    ${renderSummary(orders, menuItems)}
    <section class="panel" aria-labelledby="orders-title">
      <div class="panel-header">
        <h2 id="orders-title">Orders</h2>
        <span class="muted">${pagination.totalOrders} order(s), page ${pagination.currentPage} / ${pagination.totalPages}</span>
      </div>
      ${orders.length > 0 ? renderOrdersTable(pagination.orders, pagination.currentPage) + renderPager(pagination) : '<div class="empty">No orders yet. New Telegram or API orders will appear here.</div>'}
    </section>
    <section class="panel" aria-labelledby="store-hours-title">
      <div class="panel-header">
        <h2 id="store-hours-title">Store hours</h2>
        <span class="muted">${escapeHtml(storeHours.timezone)}</span>
      </div>
      <form class="inline" method="post" action="/admin/store-hours">
        <label class="field">
          Opens at
          <input name="openHour" type="number" min="0" max="23" step="1" value="${storeHours.openHour}" required>
        </label>
        <label class="field">
          Closes at
          <input name="closeHour" type="number" min="0" max="24" step="1" value="${storeHours.closeHour}" required>
        </label>
        <button type="submit">Save hours</button>
      </form>
      <p class="muted">Current hours: ${formatHour(storeHours.openHour)}–${formatHour(storeHours.closeHour)}. Changes are saved for reloads and restarts.</p>
    </section>
    <section class="panel" aria-labelledby="menu-title">
      <div class="panel-header">
        <h2 id="menu-title">Menu</h2>
        <span class="muted">Edit price, stock, and availability</span>
      </div>
      ${renderMenuTable(menuItems)}
    </section>
  </main>
  <script src="/admin/admin.js" defer></script>
</body>
</html>`;
}

export function renderAdminClientScript(): string {
  return `"use strict";

(() => {
  const status = document.getElementById("realtime-status");

  function setStatus(label, className) {
    if (!status) {
      return;
    }

    status.textContent = label;
    status.className = "realtime-indicator " + className;
  }

  if (!("EventSource" in window)) {
    setStatus("Realtime unsupported", "reconnecting");
    return;
  }

  let refreshTimer = undefined;
  const source = new EventSource("/admin/events", { withCredentials: true });

  source.addEventListener("connected", () => {
    setStatus("Realtime connected", "connected");
  });

  source.addEventListener("dashboard_changed", () => {
    setStatus("Refreshing orders", "connected");

    if (refreshTimer) {
      return;
    }

    refreshTimer = window.setTimeout(() => {
      window.location.reload();
    }, 500);
  });

  source.onerror = () => {
    setStatus("Realtime reconnecting", "reconnecting");
  };

  window.addEventListener("beforeunload", () => {
    source.close();
  });
})();
`;
}

export function streamAdminEvents(request: Request, response: Response) {
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();

  writeSseEvent(response, "connected", {
    timestamp: new Date().toISOString()
  });

  const unsubscribe = subscribeAdminEvents((event) => {
    writeSseEvent(response, event.type, {
      reason: event.reason,
      timestamp: event.timestamp
    });
  });

  const keepAlive = setInterval(() => {
    response.write(`: keep-alive ${Date.now()}\n\n`);
  }, 25000);

  request.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
    response.end();
  });
}

export async function updateAdminOrderStatus(request: Request, response: Response) {
  const status = String(request.body.status ?? "");

  if (!ORDER_STATUSES.includes(status as OrderStatus)) {
    throw new AppError(400, "Invalid order status.");
  }

  await updateOrderStatus(String(request.params.orderId), status as OrderStatus);
  response.redirect(303, getAdminRedirectPath(request));
}

export async function deleteAdminOrder(request: Request, response: Response) {
  await deleteOrder(String(request.params.orderId));
  response.redirect(303, getAdminRedirectPath(request));
}

export function updateAdminMenuItem(request: Request, response: Response) {
  const price = Number(request.body.price);
  const stockQuantity = Number(request.body.stockQuantity);

  if (!Number.isInteger(price) || price < 0) {
    throw new AppError(400, "Invalid price.");
  }

  if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
    throw new AppError(400, "Invalid stock quantity.");
  }

  updateMenuItem(String(request.params.sku), {
    price,
    stockQuantity,
    isAvailable: request.body.isAvailable === "on"
  });

  response.redirect(303, "/admin");
}

export async function updateAdminStoreHours(
  request: Request,
  response: Response,
  input: { openHour: number; closeHour: number }
) {
  await updateStoreHours(input);
  response.redirect(303, getAdminRedirectPath(request));
}

function renderSummary(orders: Order[], menuItems: MenuItem[]): string {
  const paidOrders = orders.filter((order) => order.status === "PAID");
  const paidRevenue = paidOrders.reduce((sum, order) => sum + order.quote.total, 0);
  const confirmedCodValue = orders
    .filter((order) => order.status === "CONFIRMED_COD")
    .reduce((sum, order) => sum + order.quote.total, 0);
  const lowStock = menuItems.filter((item) => item.stockQuantity <= 5).length;

  return `<section class="summary" aria-label="Admin summary">
    <div class="metric">Orders<b>${orders.length}</b></div>
    <div class="metric">Revenue collected<b>${formatVnd(paidRevenue)}</b></div>
    <div class="metric">Paid orders<b>${paidOrders.length}</b></div>
    <div class="metric">COD awaiting collection<b>${formatVnd(confirmedCodValue)}</b></div>
    <div class="metric">Low stock<b>${lowStock}</b></div>
  </section>`;
}

type OrdersPagination = {
  orders: Order[];
  currentPage: number;
  totalPages: number;
  totalOrders: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

function paginateOrders(orders: Order[], pageInput: unknown): OrdersPagination {
  const totalOrders = orders.length;
  const totalPages = Math.max(1, Math.ceil(totalOrders / ORDERS_PER_PAGE));
  const requestedPage = Number(pageInput);
  const currentPage = Number.isInteger(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), totalPages)
    : 1;
  const startIndex = (currentPage - 1) * ORDERS_PER_PAGE;

  return {
    orders: orders.slice(startIndex, startIndex + ORDERS_PER_PAGE),
    currentPage,
    totalPages,
    totalOrders,
    hasPrevious: currentPage > 1,
    hasNext: currentPage < totalPages
  };
}

function renderOrdersTable(orders: Order[], currentPage: number): string {
  return `<table>
    <thead>
      <tr>
        <th>Order</th>
        <th>Customer</th>
        <th>Items</th>
        <th>Total</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${orders.map((order) => renderOrderRow(order, currentPage)).join("")}
    </tbody>
  </table>`;
}

function renderOrderRow(order: Order, currentPage: number): string {
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
        ${order.quote.items.map((item) => `<li>${escapeHtml(item.name)} x ${item.quantity}</li>`).join("")}
      </ul>
    </td>
    <td data-label="Total">${formatVnd(order.quote.total)}</td>
    <td data-label="Actions">
      <div class="actions">
      <form class="inline" method="post" action="/admin/orders/${encodeURIComponent(order.id)}/status">
        <input type="hidden" name="page" value="${currentPage}">
        <select name="status" aria-label="Order status">
          ${getSelectableOrderStatuses(order.status).map(
            (status) => `<option value="${status}" ${status === order.status ? "selected" : ""}>${status}</option>`
          ).join("")}
        </select>
        <button class="ghost-button" type="submit">Save</button>
      </form>
      <form class="inline" method="post" action="/admin/orders/${encodeURIComponent(order.id)}/delete">
        <input type="hidden" name="page" value="${currentPage}">
        <button class="danger-button" type="submit">Delete</button>
      </form>
      </div>
    </td>
  </tr>`;
}

function renderPager(pagination: OrdersPagination): string {
  return `<nav class="pager" aria-label="Orders pagination">
    <span class="muted">Showing ${pagination.orders.length} of ${pagination.totalOrders}</span>
    <div class="pager-controls">
      ${
        pagination.hasPrevious
          ? `<a href="/admin?page=${pagination.currentPage - 1}">Previous</a>`
          : '<span class="disabled">Previous</span>'
      }
      <span class="muted">Page ${pagination.currentPage} / ${pagination.totalPages}</span>
      ${
        pagination.hasNext
          ? `<a href="/admin?page=${pagination.currentPage + 1}">Next</a>`
          : '<span class="disabled">Next</span>'
      }
    </div>
  </nav>`;
}

function renderMenuTable(menuItems: MenuItem[]): string {
  return `<table>
    <thead>
      <tr>
        <th>Item</th>
        <th>Category</th>
        <th>Current state</th>
        <th>Edit</th>
      </tr>
    </thead>
    <tbody>
      ${menuItems.map(renderMenuRow).join("")}
    </tbody>
  </table>`;
}

function renderMenuRow(item: MenuItem): string {
  const stockClass = item.stockQuantity > 5 && item.isAvailable ? "ok" : "warn";
  const stockText = item.isAvailable ? `${item.stockQuantity} left` : "Unavailable";

  return `<tr>
    <td data-label="Item">
      <div class="menu-item-cell">
        <img class="menu-thumb" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy">
        <div>
          <span class="sku">${escapeHtml(item.name)}</span><br>
          <code>${escapeHtml(item.sku)}</code><br>
          <span class="muted">${escapeHtml(item.description)}</span>
        </div>
      </div>
    </td>
    <td data-label="Category">${escapeHtml(item.categoryName)}</td>
    <td data-label="Current state">
      ${formatVnd(item.price)}<br>
      <span class="status ${stockClass}">${escapeHtml(stockText)}</span>
    </td>
    <td data-label="Edit">
      <form class="inline" method="post" action="/admin/menu/${encodeURIComponent(item.sku)}">
        <label class="field">
          Price
          <input name="price" type="number" min="0" step="1000" value="${item.price}" required>
        </label>
        <label class="field">
          Stock
          <input name="stockQuantity" type="number" min="0" step="1" value="${item.stockQuantity}" required>
        </label>
        <label class="field">
          Active
          <input name="isAvailable" type="checkbox" ${item.isAvailable ? "checked" : ""}>
        </label>
        <button type="submit">Save</button>
      </form>
    </td>
  </tr>`;
}

function requestAdminAuth(request: Request, response: Response) {
  if (request.method === "GET" && request.accepts("html") && !request.path.endsWith(".js")) {
    response.redirect(303, `/admin/login?next=${encodeURIComponent(safeAdminPath(request.originalUrl))}`);
    return;
  }

  response.status(401).send("Authentication required.");
}

function writeSseEvent(response: Response, event: string, data: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function getAdminRedirectPath(request: Request): string {
  const requestedPage = Number(request.body.page);

  if (Number.isInteger(requestedPage) && requestedPage > 1) {
    return `/admin?page=${requestedPage}`;
  }

  return "/admin";
}

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createAdminSessionToken(username: string): string {
  const expiresAt = Date.now() + ADMIN_SESSION_MAX_AGE_MS;
  const payload = Buffer.from(JSON.stringify({ username, expiresAt })).toString("base64url");
  const signature = signAdminSessionPayload(payload);

  return `${payload}.${signature}`;
}

function verifyAdminSessionToken(token: string): boolean {
  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return false;
  }

  if (!safeEqual(signature, signAdminSessionPayload(payload))) {
    return false;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      username?: string;
      expiresAt?: number;
    };

    return session.username === config.admin.username && typeof session.expiresAt === "number" && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function signAdminSessionPayload(payload: string): string {
  return createHmac("sha256", getAdminSessionSecret()).update(payload).digest("base64url");
}

function getAdminSessionSecret(): string {
  return config.admin.sessionSecret || config.admin.password;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};

  for (const pair of cookieHeader?.split(";") ?? []) {
    const separatorIndex = pair.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function safeAdminPath(path: string): string {
  if (!path.startsWith("/admin") || path.startsWith("/admin/login")) {
    return "/admin";
  }

  return path;
}
