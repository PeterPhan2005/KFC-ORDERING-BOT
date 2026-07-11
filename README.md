# KFC Tracks

Fake KFC ordering backend for experimenting with Messenger ordering, coupons, COD, and VNPay sandbox payment.

## Current slice

- Fake menu API.
- Quote API that calculates subtotal, discount, delivery fee, and total.
- Order creation API for COD and VNPay-pending flows.
- In-memory order repository for local development.
- Tests for pricing and order endpoints.

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

## API

### `GET /menu`

Returns fake KFC menu items and categories.

### `POST /orders/quote`

```json
{
  "items": [
    { "sku": "FRIED_CHICKEN_2PC", "quantity": 2 },
    { "sku": "PEPSI_REGULAR", "quantity": 1 }
  ],
  "couponCode": "KFC20",
  "deliveryAddress": "123 Nguyen Trai, District 1, HCMC"
}
```

### `POST /orders`

```json
{
  "items": [{ "sku": "ZINGER_BURGER", "quantity": 1 }],
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

### Messenger smoke test

Before adding AI/NLU, this server can prove that Messenger can trigger backend logic.

Endpoints:

- `GET /webhooks/meta`: Meta callback verification.
- `POST /webhooks/meta`: Messenger message receiver.

Smoke behavior:

- User sends `a` to the Facebook Page.
- Server creates a fake COD order with `FRIED_CHICKEN_2PC` and `PEPSI_REGULAR`.
- Server replies to Messenger with order id, status, and total.

Local tunnel setup:

```bash
npm run dev
ngrok http 3000
```

Meta Developers setup:

- Callback URL: `https://your-ngrok-domain/webhooks/meta`
- Verify token: same value as `META_VERIFY_TOKEN`
- Subscribe to the Page `messages` webhook field.
- Make sure `META_PAGE_ACCESS_TOKEN` belongs to the linked Page.

Manual webhook verification test:

```bash
curl "http://localhost:3000/webhooks/meta?hub.mode=subscribe&hub.verify_token=$META_VERIFY_TOKEN&hub.challenge=hello"
```

### Admin dashboard

Set these environment variables:

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me-to-a-real-password
```

Then open:

```text
http://localhost:3000/admin
```

The dashboard lists in-memory orders and lets you update fake order status while testing Messenger and payments.

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
