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

## Deploy later

This API is ready to push to GitHub. For AWS, the lowest-friction path for this type of Node.js service is usually AWS App Runner from a GitHub repository. ECS Fargate is better when you want full container control, and Elastic Beanstalk is still fine for a classic Node.js web app deployment.

Container build:

```bash
docker build -t kfc-tracks .
docker run --rm -p 3000:3000 kfc-tracks
```
