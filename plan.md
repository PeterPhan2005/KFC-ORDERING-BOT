# KFC fake ordering system plan

## Danh gia nhanh

Plan hien tai dung huong: Meta Page/App -> webhook -> chatbot -> fake KFC order server -> payment -> voice. Diem can cai tien la tach ro cac lop xu ly de bot khong tao don hang qua som va khong tin vao du lieu do nguoi dung/LLM tu tinh.

Kien truc nen di theo cac khoi sau:

- Messenger adapter: nhan webhook Meta, verify request, chong duplicate event, gui reply.
- Conversation engine: quan ly session theo `sender_psid`, hoi lai thong tin con thieu, confirm truoc khi tao don.
- NLU/order parser: chuyen text tieng Viet thanh JSON co schema ro rang, co validation menu/coupon.
- Fake KFC backend: source of truth cho menu, coupon, pricing, order status.
- Payment module: COD hoac VNPay sandbox, cap nhat order bang callback/IPN da verify.
- Admin/test view: xem order, payment status, conversation logs de debug.

## Phases

### Phase 0 - Project skeleton

Muc tieu: co server local chay duoc, co env config, co tunnel public de Meta goi webhook.

De xuat stack cho prototype:

- Node.js + TypeScript.
- Fastify hoac Express cho API.
- SQLite + Prisma cho dev nhanh, co the doi Postgres sau.
- Zod cho validate input/schema.
- Vitest/Supertest cho API tests.
- Ngrok/Cloudflare Tunnel cho webhook dev.

### Phase 1 - Fake KFC server

API toi thieu:

- `GET /health`
- `GET /menu`
- `POST /orders/quote`: tinh gia gio hang + coupon, chua tao order final.
- `POST /orders`: tao order sau khi user confirm.
- `GET /orders/:id`
- `PATCH /orders/:id/status`

Order status nen co:

- `DRAFT`
- `AWAITING_CONFIRMATION`
- `PENDING_PAYMENT`
- `PAID`
- `CONFIRMED_COD`
- `CANCELLED`
- `FAILED`

Pricing rules:

- Gia lay tu backend, khong lay tu chatbot.
- Coupon validate tren backend, gom expiry, min subtotal, usage limit, payment method neu can.
- Response quote tra ve subtotal, discount, delivery fee, total, invalid coupon reason.

### Phase 2 - Messenger webhook

Endpoints:

- `GET /webhooks/meta`: verify `hub.mode`, `hub.verify_token`, `hub.challenge`.
- `POST /webhooks/meta`: nhan message events, verify signature neu cau hinh `APP_SECRET`, bo qua message echoes, xu ly idempotent.

Flow:

1. User gui tin nhan.
2. Adapter parse event va dua vao conversation engine.
3. Bot hoi them thong tin con thieu: mon, so luong, dia chi, sdt, coupon, payment method.
4. Khi du thong tin, bot goi `POST /orders/quote`.
5. Bot gui tom tat va yeu cau xac nhan.
6. User confirm thi bot goi `POST /orders`.

### Phase 3 - NLU va dialog manager

Bat dau don gian:

- Rule parser cho menu aliases: "ga ran", "combo", "burger zinger", "pepsi", "khoai".
- LLM structured output sau do validate bang Zod.
- Khong tao order neu parser confidence thap hoac thieu thong tin quan trong.

Schema output mau:

```json
{
  "intent": "create_order",
  "items": [{ "sku": "ZINGER", "quantity": 2 }],
  "couponCode": "KFC20",
  "deliveryAddress": "123 Nguyen Trai",
  "phone": "0900000000",
  "paymentMethod": "vnpay"
}
```

### Phase 4 - Payment

COD:

- Sau confirm, tao order status `CONFIRMED_COD`.
- Gui message xac nhan tong tien can tra khi nhan hang.

VNPay sandbox:

- Sau confirm, tao order status `PENDING_PAYMENT`.
- Backend build VNPay payment URL va gui link cho user.
- `ReturnUrl` chi dung de hien thi ket qua cho user.
- `IPN`/server callback da verify moi duoc dung de cap nhat order thanh `PAID`.
- Secret/hash chi nam tren backend.

### Phase 5 - Voice ordering

Lam sau khi text ordering on dinh:

- Reuse conversation engine va order APIs.
- Voice layer chi them speech-to-text/text-to-speech/realtime transport.
- ElevenLabs phu hop voice agent/TTS/STT; Agora phu hop realtime audio session. Nen quyet dinh sau khi co UX voice cu the: web call, phone call, hay in-app voice.

## Rủi ro cần kiểm soát

- Meta App Review: neu muon nguoi ngoai admin/tester dung bot, can review/approval cho Messenger permissions.
- 24-hour messaging window: bot nen reply trong ngu canh conversation hien tai, tranh gui order update ngoai policy.
- Duplicate webhooks: Meta co the retry, nen luu event id/timestamp de khong tao trung don.
- LLM hallucination: moi SKU, coupon, total deu phai validate bang backend.
- Payment security: khong tin return URL client-side; verify hash/IPN server-side.
- Privacy: token/env secrets khong commit, co privacy policy/data deletion neu public app.

## First vertical slice

Muc tieu slice dau tien:

1. Server chay local.
2. `GET /menu` tra menu fake.
3. `POST /orders/quote` tinh gia va coupon.
4. `POST /orders` tao order COD.
5. `GET/POST /webhooks/meta` nhan tin, parse mot vai cau order don gian, reply summary.

Sau slice nay moi them VNPay sandbox.
