# KFC Tracks

Fake KFC ordering backend with a local admin dashboard, fake menu/order APIs, Telegram bot experiments, coupons, COD, and VNPay sandbox payment.

## Current slice

- Menu API loaded from `assets/data/kfc_catalog.json` with product images from `assets/image`.
- Local admin dashboard for orders and menu edits.
- Quote API that calculates subtotal, discount, delivery fee, and total.
- Order creation API for COD and VNPay-pending flows.
- Telegram conversational cart with Vietnamese menu lookup, stock-aware alternatives, coupon selection, COD/VNPay selection, order notes, and confirmation.
- Telegram sends up to three catalog product images after it successfully adds menu items to a customer's draft.
- Safe menu matching that asks for clarification instead of silently replacing an unknown or ambiguous item.
- A fixed `20,000 VND` delivery fee, with delivery address echoed in the draft for customer verification.
- Validated order status transitions: only a pending VNPay order can become paid or be cancelled; cancellation releases its reserved stock.
- PostgreSQL-backed order repository when `DATABASE_URL` is configured; in-memory fallback only for local/test use.
- VNPay sandbox payment-link endpoint plus signed return/IPN callback validation.
- Tests for pricing, order transitions, order endpoints, and core chatbot flows.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

Admin dashboard:

```text
http://localhost:3000/admin
```

## API

### `GET /menu`

Returns fake KFC menu items and categories.

### `POST /orders/quote`

```json
{
  "items": [
    { "sku": "offline-combo-1-nguoi-combo-burger-zinger-10", "quantity": 1 },
    { "sku": "offline-thuc-uong-trang-mieng-pepsi-tieu-chuan-3", "quantity": 1 }
  ],
  "couponCode": "KFC20",
  "deliveryAddress": "123 Nguyen Trai, District 1, HCMC"
}
```

### `POST /orders`

```json
{
  "items": [{ "sku": "offline-burger-com-mi-y-burger-ga-zinger-4", "quantity": 1 }],
  "couponCode": "FREESHIP",
  "paymentMethod": "cod",
  "customer": {
    "name": "Peter",
    "phone": "0900000000",
    "address": "123 Nguyen Trai, District 1, HCMC"
  },
  "notes": "It cay"
}
```

### VNPay sandbox

For an order created with `paymentMethod: "vnpay"`, redirect the customer to:

```text
GET /payments/vnpay/orders/:orderId
```

The endpoint creates a signed sandbox payment URL. The VNPay IPN endpoint is:

```text
GET /payments/vnpay/ipn
```

Set `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL`, and `VNPAY_IPN_URL` before using it. The IPN signature and order amount are verified before an order is marked `PAID`.

### Admin dashboard

Set these environment variables:

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me-to-a-real-password
ADMIN_SESSION_SECRET=change-me-to-a-long-random-string
```

Then open:

```text
http://localhost:3000/admin
```

The dashboard lists PostgreSQL orders when `DATABASE_URL` is configured and lets you update order status while testing local orders, Telegram, and payments.

Current dashboard features:

- View order list, customer info, items, totals, and status.
- View collected revenue from `PAID` orders and the value of confirmed COD orders still awaiting collection.
- Paginate orders to keep the dashboard compact.
- Update order status using only valid transitions, including `CONFIRMED_COD -> PAID` after cash collection.
- Delete orders.
- View menu items.
- Edit item price, stock quantity, and active/unavailable state.
- Edit store opening and closing hours used by the Telegram bot. The default is `08:00-22:00` in `Asia/Ho_Chi_Minh`.

### Telegram bot

Telegram smoke-test endpoint:

```text
POST /webhooks/telegram
```

Supported examples:

- `cho mình 2 combo burger zinger và 1 pepsi`
- `M001-2` to order two units of menu item `M001` (also supports `M001 x 2`)
- `coupon KFC20`
- `thanh toán vnpay` or `COD`
- `ghi chú ít đá`
- `sđt 0900000000, địa chỉ 123 Nguyễn Trãi Quận 1`
- `không có coupon` when the customer does not have a discount code
- `xác nhận`

The bot keeps a per-chat in-memory draft. It shows a fresh quote, checks stock and opening hours, asks for phone, delivery address, and coupon choice, and only creates an order after confirmation. VNPay orders are created as `PENDING_PAYMENT`; the bot returns a payment link, and the verified IPN callback marks a successful payment as `PAID`.

Every displayed menu item has a short order ID such as `M001`. Customers can order with the ID and quantity without typing the full Vietnamese product name: `M001-2`, `M001 x 2`, or `M001 2`.

For product images to work in Telegram, `APP_BASE_URL` must be a public HTTPS URL that can serve `/assets/image/*` (for local testing, use the current ngrok URL). Restart `npm run dev` after changing `.env`.

### Live Telegram E2E test

Set `TELEGRAM_E2E_CHAT_ID` to the numeric chat ID of your own private chat with the bot, then run:

```bash
npm run test:e2e:telegram
```

It sends a realistic `/menu` Telegram webhook payload to the configured public server. The server verifies the secret and calls Telegram `sendMessage`; confirm that the menu reply arrives in your chat. This test is intentionally not part of `npm test` because it sends a real Telegram message.

Local tunnel setup for webhook testing:

```bash
npm run dev
ngrok http 3000
```

Create a bot:

- Open `@BotFather` in Telegram.
- Send `/newbot`.
- Choose a display name and a username ending in `bot`.
- Copy the API token into `TELEGRAM_BOT_TOKEN`.
- Set `TELEGRAM_WEBHOOK_SECRET` to a random string using letters, numbers, `_`, or `-`.

Register webhook:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://your-ngrok-domain/webhooks/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Check webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

Current ngrok example:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://eb7c-103-141-176-224.ngrok-free.app/webhooks/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

The free ngrok URL can change after restarting ngrok. Register the webhook again whenever the public URL changes.

After deploying to AWS App Runner, call `setWebhook` again with the AWS URL:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://your-aws-url/webhooks/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

## Deploy later

This API is ready to push to GitHub. For AWS, the lowest-friction path for this type of Node.js service is usually AWS App Runner from a GitHub repository. ECS Fargate is better when you want full container control, and Elastic Beanstalk is still fine for a classic Node.js web app deployment.

Suggested App Runner source deployment:

- Repository: this GitHub repo.
- Branch: `main`.
- Runtime: Node.js.
- Build command: `npm ci && npm run build`.
- Start command: `npm start`.
- Port: `3000`.
- Environment variables: copy values from `.env`, but never commit `.env`.

Container build:

```bash
docker build -t kfc-tracks .
docker run --rm -p 3000:3000 kfc-tracks
```

For the EC2 + PostgreSQL deployment steps, see `docs/deploy-ec2.md`.
