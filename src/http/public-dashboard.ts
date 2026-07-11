import { config } from "../config.js";
import { coupons } from "../data/coupons.js";
import { listMenuItems } from "../services/menu.js";
import { listOrders } from "../services/orders.js";
import { getStoreHours } from "../services/store.js";
import type { Coupon, MenuItem, Order } from "../types.js";

const FEATURED_ITEM_LIMIT = 8;
const COUPON_LIMIT = 6;

export async function renderPublicDashboard(): Promise<string> {
  const orders = await listOrders();
  const menuItems = listMenuItems();
  const storeHours = getStoreHours();
  const activeItems = menuItems.filter((item) => item.isAvailable && item.stockQuantity > 0);
  const featuredItems = selectFeaturedItems(activeItems);
  const activeCoupons = coupons.filter((coupon) => coupon.isActive).slice(0, COUPON_LIMIT);
  const stats = summarizeDashboard(orders, menuItems);
  const vnpayStatus = isVnpayConfigured() ? "Configured" : "Pending sandbox credentials";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KFC Tracks Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f6f1;
      color: #171717;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      background: #f7f6f1;
    }
    a {
      color: inherit;
    }
    .site-header {
      background: #b91c1c;
      color: #fff;
      border-bottom: 4px solid #171717;
    }
    .header-inner {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      min-height: 76px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .brand-mark {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      background: #fff;
      object-fit: contain;
      padding: 6px;
      border: 1px solid rgba(255, 255, 255, 0.52);
    }
    h1, h2, h3, p {
      margin: 0;
      letter-spacing: 0;
    }
    h1 {
      font-size: 24px;
      line-height: 1.15;
    }
    h2 {
      font-size: 19px;
      line-height: 1.2;
    }
    h3 {
      font-size: 15px;
      line-height: 1.25;
    }
    .subtitle {
      margin-top: 4px;
      color: rgba(255, 255, 255, 0.84);
      font-size: 14px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      padding: 0 13px;
      border: 1px solid rgba(255, 255, 255, 0.58);
      border-radius: 6px;
      color: #fff;
      text-decoration: none;
      white-space: nowrap;
      font-size: 14px;
    }
    .button.solid {
      background: #171717;
      border-color: #171717;
    }
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 22px 0 32px;
    }
    .overview {
      display: grid;
      grid-template-columns: minmax(0, 1.12fr) minmax(320px, 0.88fr);
      gap: 18px;
      align-items: stretch;
    }
    .hero {
      min-height: 330px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #dfddd4;
      background:
        linear-gradient(90deg, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0.26)),
        url("/assets/image/about-kfc.png") center / cover no-repeat,
        #171717;
      color: #fff;
      display: flex;
      align-items: flex-end;
      padding: 24px;
    }
    .hero-copy {
      width: min(100%, 600px);
      display: grid;
      gap: 12px;
    }
    .hero-title {
      font-size: clamp(30px, 4vw, 48px);
      line-height: 1.02;
    }
    .hero-text {
      color: rgba(255, 255, 255, 0.86);
      max-width: 62ch;
      line-height: 1.55;
    }
    .badge-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 0 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.16);
      border: 1px solid rgba(255, 255, 255, 0.32);
      font-size: 13px;
    }
    .panel {
      background: #fff;
      border: 1px solid #dfddd4;
      border-radius: 8px;
      overflow: hidden;
    }
    .panel-header {
      min-height: 54px;
      padding: 14px 16px;
      border-bottom: 1px solid #ece9df;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .panel-body {
      padding: 16px;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .metric {
      min-height: 94px;
      border: 1px solid #ece9df;
      border-radius: 8px;
      padding: 13px;
      background: #fbfaf6;
    }
    .metric span {
      display: block;
      color: #66635d;
      font-size: 12px;
      text-transform: uppercase;
    }
    .metric b {
      display: block;
      margin-top: 7px;
      font-size: 22px;
      line-height: 1.1;
      word-break: break-word;
    }
    .section {
      margin-top: 18px;
    }
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 12px;
    }
    .product-card {
      background: #fff;
      border: 1px solid #dfddd4;
      border-radius: 8px;
      overflow: hidden;
      min-height: 100%;
      display: grid;
      grid-template-rows: 150px 1fr;
    }
    .product-card img {
      width: 100%;
      height: 150px;
      object-fit: cover;
      background: #f0eee6;
      display: block;
    }
    .product-body {
      padding: 13px;
      display: grid;
      gap: 8px;
      align-content: start;
    }
    .product-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: start;
      color: #66635d;
      font-size: 13px;
    }
    .price {
      color: #b91c1c;
      font-weight: 800;
      white-space: nowrap;
    }
    .muted {
      color: #66635d;
      font-size: 13px;
      line-height: 1.45;
    }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 0 9px;
      border-radius: 999px;
      border: 1px solid #a5c98f;
      color: #23610d;
      background: #f0f8ea;
      font-size: 12px;
      white-space: nowrap;
    }
    .status.warn {
      border-color: #e3c46a;
      color: #755400;
      background: #fff7de;
    }
    .two-column {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 18px;
    }
    .list {
      display: grid;
      gap: 10px;
    }
    .list-row {
      display: grid;
      gap: 4px;
      padding-bottom: 10px;
      border-bottom: 1px solid #ece9df;
    }
    .list-row:last-child {
      padding-bottom: 0;
      border-bottom: 0;
    }
    .code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      color: #171717;
      background: #f4f2eb;
      border: 1px solid #e5e1d7;
      border-radius: 6px;
      padding: 2px 6px;
      word-break: break-all;
    }
    .endpoint-table {
      width: 100%;
      border-collapse: collapse;
    }
    .endpoint-table th,
    .endpoint-table td {
      padding: 11px 0;
      border-bottom: 1px solid #ece9df;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    .endpoint-table th {
      color: #66635d;
      font-size: 12px;
      text-transform: uppercase;
    }
    .endpoint-table tr:last-child td {
      border-bottom: 0;
    }
    .footer-note {
      margin-top: 18px;
      color: #66635d;
      font-size: 13px;
      text-align: center;
    }
    @media (max-width: 860px) {
      .overview,
      .two-column {
        grid-template-columns: 1fr;
      }
      .hero {
        min-height: 300px;
      }
    }
    @media (max-width: 560px) {
      .header-inner,
      main {
        width: min(100% - 24px, 1180px);
      }
      .header-actions {
        width: 100%;
      }
      .button {
        flex: 1 1 auto;
      }
      .hero {
        min-height: 340px;
        padding: 18px;
      }
      .metric-grid {
        grid-template-columns: 1fr;
      }
      .product-card {
        grid-template-rows: 142px 1fr;
      }
      .product-card img {
        height: 142px;
      }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <div class="brand">
        <img class="brand-mark" src="/assets/image/logo_footer.png" alt="" aria-hidden="true">
        <div>
          <h1>KFC Tracks Dashboard</h1>
          <p class="subtitle">PeterPhan.online ordering monitor</p>
        </div>
      </div>
      <nav class="header-actions" aria-label="Primary">
        <a class="button" href="/menu">Menu API</a>
        <a class="button" href="/health">Health</a>
        <a class="button solid" href="/admin">Admin</a>
      </nav>
    </div>
  </header>
  <main>
    <section class="overview" aria-labelledby="dashboard-title">
      <div class="hero">
        <div class="hero-copy">
          <div class="badge-row">
            <span class="badge">Public review page</span>
            <span class="badge">COD and VNPay sandbox</span>
            <span class="badge">${escapeHtml(formatHour(storeHours.openHour))} - ${escapeHtml(formatHour(storeHours.closeHour))}</span>
          </div>
          <h2 class="hero-title" id="dashboard-title">Food ordering dashboard for VNPay review</h2>
          <p class="hero-text">This public page summarizes the live ordering service, catalog, payment endpoints, and operational status for peterphan.online.</p>
        </div>
      </div>
      <aside class="panel" aria-labelledby="operations-title">
        <div class="panel-header">
          <h2 id="operations-title">Operations</h2>
          <span class="status ${vnpayStatus === "Configured" ? "" : "warn"}">${escapeHtml(vnpayStatus)}</span>
        </div>
        <div class="panel-body">
          <div class="metric-grid">
            <div class="metric"><span>Total orders</span><b>${stats.totalOrders}</b></div>
            <div class="metric"><span>Paid revenue</span><b>${formatVnd(stats.paidRevenue)}</b></div>
            <div class="metric"><span>Available items</span><b>${activeItems.length}</b></div>
            <div class="metric"><span>Pending VNPay</span><b>${stats.pendingVnpayOrders}</b></div>
          </div>
        </div>
      </aside>
    </section>

    <section class="section" aria-labelledby="menu-title">
      <div class="panel-header">
        <h2 id="menu-title">Featured Menu</h2>
        <span class="muted">${menuItems.length} catalog items across ${stats.categoryCount} categories</span>
      </div>
      <div class="product-grid">
        ${featuredItems.map(renderProductCard).join("")}
      </div>
    </section>

    <section class="section two-column">
      <div class="panel" aria-labelledby="payment-title">
        <div class="panel-header">
          <h2 id="payment-title">Payment Review</h2>
          <span class="status">Online</span>
        </div>
        <div class="panel-body">
          <table class="endpoint-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Domain</td>
                <td><span class="code">${escapeHtml(config.appBaseUrl)}</span></td>
              </tr>
              <tr>
                <td>VNPay return</td>
                <td><span class="code">${escapeHtml(config.vnpay.returnUrl)}</span></td>
              </tr>
              <tr>
                <td>VNPay IPN</td>
                <td><span class="code">${escapeHtml(config.vnpay.ipnUrl)}</span></td>
              </tr>
              <tr>
                <td>Payment methods</td>
                <td>COD, VNPay sandbox</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel" aria-labelledby="coupon-title">
        <div class="panel-header">
          <h2 id="coupon-title">Active Promotions</h2>
          <span class="muted">${coupons.filter((coupon) => coupon.isActive).length} live</span>
        </div>
        <div class="panel-body">
          <div class="list">
            ${activeCoupons.map(renderCouponRow).join("")}
          </div>
        </div>
      </div>
    </section>

    <section class="section two-column">
      <div class="panel" aria-labelledby="service-title">
        <div class="panel-header">
          <h2 id="service-title">Service Channels</h2>
          <span class="muted">Public endpoints</span>
        </div>
        <div class="panel-body">
          <table class="endpoint-table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span class="code">/health</span></td>
                <td>Application health check</td>
              </tr>
              <tr>
                <td><span class="code">/menu</span></td>
                <td>Catalog data</td>
              </tr>
              <tr>
                <td><span class="code">/orders</span></td>
                <td>Order API</td>
              </tr>
              <tr>
                <td><span class="code">/webhooks/telegram</span></td>
                <td>Telegram ordering bot</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel" aria-labelledby="merchant-title">
        <div class="panel-header">
          <h2 id="merchant-title">Merchant Info</h2>
          <span class="status">Active</span>
        </div>
        <div class="panel-body">
          <div class="list">
            <div class="list-row">
              <h3>Website</h3>
              <p class="muted">peterphan.online</p>
            </div>
            <div class="list-row">
              <h3>Store hours</h3>
              <p class="muted">${escapeHtml(formatHour(storeHours.openHour))} - ${escapeHtml(formatHour(storeHours.closeHour))} ${escapeHtml(storeHours.timezone)}</p>
            </div>
            <div class="list-row">
              <h3>Order state</h3>
              <p class="muted">${stats.confirmedCodOrders} COD confirmed, ${stats.paidOrders} paid, ${stats.lowStockItems} low-stock item(s)</p>
            </div>
            <div class="list-row">
              <h3>Disclosure</h3>
              <p class="muted">Independent demo ordering system for payment and chatbot integration review.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <p class="footer-note">KFC Tracks runs on peterphan.online with admin controls protected behind login.</p>
  </main>
</body>
</html>`;
}

function summarizeDashboard(orders: Order[], menuItems: MenuItem[]) {
  const paidOrders = orders.filter((order) => order.status === "PAID");
  const confirmedCodOrders = orders.filter((order) => order.status === "CONFIRMED_COD").length;
  const pendingVnpayOrders = orders.filter((order) => order.status === "PENDING_PAYMENT").length;
  const paidRevenue = paidOrders.reduce((sum, order) => sum + order.quote.total, 0);
  const lowStockItems = menuItems.filter((item) => item.isAvailable && item.stockQuantity <= 5).length;
  const categoryCount = new Set(menuItems.flatMap((item) => item.categoryIds)).size;

  return {
    totalOrders: orders.length,
    paidOrders: paidOrders.length,
    confirmedCodOrders,
    pendingVnpayOrders,
    paidRevenue,
    lowStockItems,
    categoryCount
  };
}

function selectFeaturedItems(items: MenuItem[]): MenuItem[] {
  return [...items]
    .sort((left, right) => getDiscount(right) - getDiscount(left) || right.price - left.price || left.name.localeCompare(right.name))
    .slice(0, FEATURED_ITEM_LIMIT);
}

function renderProductCard(item: MenuItem): string {
  const stockClass = item.stockQuantity > 5 ? "" : "warn";
  const stockText = item.stockQuantity > 5 ? "Available" : "Low stock";

  return `<article class="product-card">
    <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy">
    <div class="product-body">
      <div class="product-meta">
        <span>${escapeHtml(item.categoryName)}</span>
        <span class="price">${formatVnd(item.price)}</span>
      </div>
      <h3>${escapeHtml(item.name)}</h3>
      <p class="muted">${escapeHtml(item.description)}</p>
      <span class="status ${stockClass}">${escapeHtml(stockText)}: ${item.stockQuantity}</span>
    </div>
  </article>`;
}

function renderCouponRow(coupon: Coupon): string {
  const methods = coupon.eligiblePaymentMethods?.map((method) => method.toUpperCase()).join(", ") ?? "COD, VNPAY";

  return `<div class="list-row">
    <h3><span class="code">${escapeHtml(coupon.code)}</span> ${escapeHtml(coupon.label)}</h3>
    <p class="muted">Minimum ${formatVnd(coupon.minSubtotal)}. Payment: ${escapeHtml(methods)}.</p>
  </div>`;
}

function getDiscount(item: MenuItem): number {
  return Math.max(0, (item.originalPrice ?? item.price) - item.price);
}

function isVnpayConfigured(): boolean {
  return Boolean(config.vnpay.tmnCode && config.vnpay.hashSecret && config.vnpay.tmnCode !== "replace-me" && config.vnpay.hashSecret !== "replace-me");
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
