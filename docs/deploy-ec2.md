# EC2 deployment guide

This guide assumes a new Ubuntu EC2 host with no application files yet. Do not put Telegram tokens, VNPay credentials, or database passwords in Git.

## Before deployment

1. Push the finished project to GitHub.
2. Point a domain you control to the EC2 public IP. Telegram webhooks and VNPay callbacks need a stable public HTTPS endpoint. For temporary testing, keep using ngrok instead of the EC2 public DNS.
3. In the EC2 security group, allow inbound TCP `22` only from your IP, and `80`/`443` from the internet. Do not expose PostgreSQL port `5432`.
4. Create production credentials for `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `POSTGRES_PASSWORD`, `VNPAY_TMN_CODE`, and `VNPAY_HASH_SECRET`.

## Install the host prerequisites

```bash
ssh -i /path/to/key.pem ubuntu@YOUR_EC2_PUBLIC_DNS
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
exit
```

Sign in again, then verify Docker:

```bash
docker --version
docker compose version
```

## Fetch and configure the project

```bash
git clone https://github.com/PeterPhan2005/KFC-ORDERING-BOT.git kfc_tracks
cd kfc_tracks
cp .env.example .env
chmod 600 .env
```

Set at least these values in `.env`:

```env
NODE_ENV=production
APP_BASE_URL=https://bot.example.com
POSTGRES_PASSWORD=use-a-long-random-password
ADMIN_USERNAME=admin
ADMIN_PASSWORD=use-a-long-random-password
ADMIN_SESSION_SECRET=use-a-long-random-password
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=use-letters-numbers-underscore-or-dash
TELEGRAM_BOT_URL=https://t.me/Cfc_Kfc_ordering_bot
VNPAY_TMN_CODE=...
VNPAY_HASH_SECRET=...
VNPAY_RETURN_URL=https://bot.example.com/payments/vnpay/return
VNPAY_IPN_URL=https://bot.example.com/payments/vnpay/ipn
TELEGRAM_E2E_CHAT_ID=your-numeric-chat-id
```

## Start the app and PostgreSQL

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

The app applies `migrations/001_create_orders.sql` at startup. Check the local container health endpoint:

```bash
curl http://127.0.0.1:3000/health
```

## Add HTTPS reverse proxy

Run a reverse proxy such as Caddy or Nginx in front of port `3000`; it must terminate TLS for your domain and proxy traffic to `127.0.0.1:3000`. Do not register Telegram or VNPay callbacks with plain HTTP.

After HTTPS works, verify these paths publicly:

```bash
curl https://bot.example.com/health
curl -I https://bot.example.com/assets/image/PEPSI-STD.jpg
```

## Register and test Telegram

From the EC2 project directory:

```bash
set -a
source .env
set +a

curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=$APP_BASE_URL/webhooks/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"

docker compose exec app npm run test:e2e:telegram
```

The E2E script posts a realistic `/menu` update to the public webhook using the configured secret. The server then calls Telegram's `sendMessage`; check the configured chat for the reply.

## Verify PostgreSQL persistence

Create a test order, then restart only the app container:

```bash
docker compose restart app
curl http://127.0.0.1:3000/orders
```

The order remains because it is stored in PostgreSQL. Draft conversations, menu edits, and store-hour changes are still process-local in this version; migrate those next if they also need to survive restart.
