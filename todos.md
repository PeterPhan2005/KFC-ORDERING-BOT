# Todos

## Now

- [ ] Scaffold Node.js + TypeScript backend.
- [ ] Tao `.env.example` voi `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `META_APP_SECRET`, `APP_BASE_URL`.
- [ ] Tao fake menu va coupon seed data.
- [ ] Implement `GET /health`, `GET /menu`.
- [ ] Implement pricing engine va `POST /orders/quote`.
- [ ] Implement order store va `POST /orders`, `GET /orders/:id`.
- [ ] Implement Meta webhook verify endpoint `GET /webhooks/meta`.
- [ ] Implement Meta message receiver `POST /webhooks/meta`.
- [ ] Implement simple Vietnamese order parser cho 3-5 mon dau tien.
- [ ] Reply Messenger bang order quote va yeu cau user confirm.

## Next

- [ ] Luu conversation sessions theo `sender_psid`.
- [ ] Them confirmation flow: user noi "dong y"/"xac nhan" moi tao order.
- [ ] Them coupon validation: expired, min subtotal, fixed/percent discount.
- [ ] Them idempotency cho webhook event va order creation.
- [ ] Them tests cho pricing, coupon, parser, order creation.
- [ ] Chay tunnel public va cau hinh Callback URL tren Meta Developers.
- [ ] Test voi Page admin/tester truoc khi xin App Review.

## Payment

- [ ] Them payment method `cod` va `vnpay`.
- [ ] Dang ky/lay VNPay sandbox `tmnCode`, `secureSecret`.
- [ ] Implement create VNPay payment URL tren backend.
- [ ] Implement `ReturnUrl` de user thay ket qua.
- [ ] Implement IPN endpoint va verify hash de cap nhat order `PAID`.
- [ ] Khong luu/order paid dua tren query return URL neu IPN chua verify.

## Later

- [ ] Admin/test dashboard de xem orders va conversation logs.
- [ ] Structured LLM parser voi schema validation.
- [ ] App Review package: screencast, privacy policy, data deletion URL.
- [ ] Voice ordering POC sau khi text flow da on dinh.
