import { beforeEach, describe, expect, it } from "vitest";
import { processChatMessage, clearConversationSessionsForTest } from "../src/services/chatbot.js";
import { getMenuItem, resetMenuForTest, updateMenuItem } from "../src/services/menu.js";
import { clearOrdersForTest, listOrders } from "../src/services/orders.js";

const OPEN_TIME = new Date("2026-07-11T05:00:00.000Z");
const CLOSED_TIME = new Date("2026-07-11T16:00:00.000Z");

describe("Telegram chatbot ordering", () => {
  beforeEach(() => {
    clearConversationSessionsForTest();
    clearOrdersForTest();
    resetMenuForTest();
  });

  it("builds and confirms a COD order from Vietnamese chat", async () => {
    await send("cho mình 2 combo burger zinger");
    await send("sdt 0900000000, địa chỉ 123 Nguyễn Trãi Quận 1");
    await send("COD");
    expect((await send("xác nhận")).reply).toContain("Bạn có mã giảm giá không?");
    await send("không có coupon");
    await send("COD");
    const result = await send("xác nhận");

    expect(result.createdOrderIds).toHaveLength(1);
    expect(result.reply).toContain("Mình đã xác nhận đơn của bạn");
    expect((await listOrders())[0]).toMatchObject({
      status: "CONFIRMED_COD",
      paymentMethod: "cod"
    });
  });

  it("supports an English checkout flow", async () => {
    await send("add 1 Zinger Burger Combo");
    await send("0900000000, 123 Nguyen Trai Street, District 1, COD");
    expect((await send("confirm")).reply).toContain("Do you have a coupon code?");
    await send("no");
    const result = await send("confirm");

    expect(result.reply).toContain("Your order has been confirmed.");
    expect((await listOrders())[0]).toMatchObject({ paymentMethod: "cod", status: "CONFIRMED_COD" });
  });

  it("switches conversation language from slash commands", async () => {
    await send("cho mình 1 combo burger zinger");

    expect((await send("/language")).reply).toContain("/vi");
    expect((await send("/en")).reply).toContain("I switched to English");
    expect((await send("cart")).reply).toContain("Your draft order");

    expect((await send("/vi")).reply).toContain("chuyển sang tiếng Việt");
    expect((await send("hello em")).reply).toContain("Chào bạn, mình đây");
    expect((await send("xem giỏ hàng")).reply).toContain("Đơn nháp của bạn");
  });

  it("supports English cart changes and address labels", async () => {
    await send("add 2 Pepsi (Regular)");
    expect((await send("change Pepsi (Regular) to 1")).reply).toContain("Changed the quantity of Pepsi (Regular) to 1.");
    expect((await send("delivery address: 123 Main Street")).reply).toContain("Delivery address: 123 Main Street.");
    expect((await send("remove Pepsi (Regular)")).reply).toContain("Removed Pepsi (Regular).");
  });

  it("recommends spicy items for natural English phrasing", async () => {
    const result = await send("give me smth spicy");

    expect(result.reply).toContain("Spicy recommendations:");
    expect(result.reply).toContain("Pepper Lime");
    expect(result.reply).not.toContain("could not find");
  });

  it("understands lowest-price and value questions in English", async () => {
    expect((await send("which food is the lowest price")).reply).toContain("Current cheapest items:");
    expect((await send("which price is the food better")).reply).toContain("For the best value");
  });

  it("recommends options by diners and budget", async () => {
    const result = await send("tối nay 3 người ăn tầm 250k");

    expect(result.reply).toContain("cho 3 người");
    expect(result.reply).toContain("250.000");
    expect(result.reply).toMatch(/\[M[0-9]{3}\]/);
  });

  it("selects the best voucher for the current cart", async () => {
    await send("cho mình 2 combo burger zinger");
    const result = await send("dùng mã nào giảm nhiều nhất");

    expect(result.reply).toContain("Mình đã chọn voucher");
    expect(result.reply).toContain("Đơn nháp của bạn");
    expect(result.reply).toContain("giảm");
  });

  it("checks loyalty points after member phone verification", async () => {
    await send("mình còn bao nhiêu điểm thành viên?");
    const result = await send("sdt 0900000000");

    expect(result.reply).toContain("xác thực thành viên");
    expect(result.reply).toContain("Điểm khả dụng");
  });

  it("hands off with structured conversation context", async () => {
    await send("cho mình 1 combo burger zinger");
    await send("coupon KFC20");
    const result = await send("cho mình gặp nhân viên");

    expect(result.reply).toContain("chuyển cuộc trò chuyện");
    expect(result.reply).toContain("Giỏ hàng");
    expect(result.reply).toContain("Voucher");
    expect(result.reply).toContain("Gợi ý bước tiếp theo");
  });

  it("applies a coupon and selects VNPay before confirmation", async () => {
    await send("cho mình 2 combo burger zinger");
    expect((await send("coupon KFC20")).reply).toContain("Mã KFC20: giảm");
    expect((await send("thanh toán vnpay")).reply).toContain("Thanh toán: VNPay");
    await send("sdt 0900000000, địa chỉ 123 Nguyễn Trãi Quận 1");
    const result = await send("chốt đơn");

    expect(result.reply).toContain("chờ thanh toán VNPay");
    expect((await listOrders())[0]).toMatchObject({
      status: "PENDING_PAYMENT",
      paymentMethod: "vnpay"
    });
    expect((await listOrders())[0].quote.coupon).toMatchObject({
      code: "KFC20",
      isApplied: true
    });
  });

  it("stores an order note and prevents cancellation after COD confirmation", async () => {
    await send("cho mình 1 combo burger zinger");
    await send("ghi chú không lấy đá");
    await send("0900000000 địa chỉ 123 Nguyễn Trãi Quận 1");
    await send("không có coupon");
    await send("COD");
    await send("xác nhận");

    expect((await send("hủy đơn")).reply).toContain("không thể hủy");
    expect((await listOrders())[0].notes).toContain("không lấy đá");
  });

  it("does not add an item outside store hours", async () => {
    const result = await send("cho mình 1 combo burger zinger", CLOSED_TIME);

    expect(result.reply).toContain("Hiện cửa hàng đang đóng");
    expect(result.reply).toContain("ngày mai lúc 08:00");
    expect(await listOrders()).toHaveLength(0);
  });

  it("does not replace an unavailable menu request with another item", async () => {
    const result = await send("cho mình 1 pizza hải sản");

    expect(result.reply).toContain("chưa tìm thấy");
    expect(result.reply).toContain("pizza hai san");
  });

  it("asks for clarification when a menu name is ambiguous", async () => {
    const result = await send("cho mình 1 burger");

    expect(result.reply).toContain("Bạn muốn chọn một trong các món này không?");
    expect(result.reply).toContain("Burger");
    expect((await send("xem giỏ hàng")).reply).toContain("trống");
  });

  it("adds multiple exact menu items with separate quantities", async () => {
    const result = await send("cho mình 1 combo burger zinger và 2 pepsi tiêu chuẩn");

    expect(result.reply).toContain("1 x Zinger Burger Combo");
    expect(result.reply).toContain("2 x Pepsi (Regular)");
    expect(result.imageUrls).toHaveLength(0);
  });

  it("does not partially add an item when requested quantity exceeds stock", async () => {
    const item = getMenuItem("offline-combo-1-nguoi-combo-burger-zinger-10")!;
    updateMenuItem(item.sku, { stockQuantity: 1, isAvailable: true });

    const result = await send("cho mình 2 combo burger zinger");

    expect(result.reply).toContain("Only 1 serving");
    expect((await send("xem giỏ hàng")).reply).toContain("trống");
  });

  it("removes an exact item from a draft", async () => {
    await send("cho mình 1 combo burger zinger");
    const result = await send("bỏ combo burger zinger");

    expect(result.reply).toContain("Mình đã bỏ Zinger Burger Combo");
    expect(result.reply).toContain("trống");
  });

  it("changes the quantity of an exact draft item", async () => {
    await send("cho mình 1 combo burger zinger");
    const result = await send("đổi combo burger zinger to 3");

    expect(result.reply).toContain("thành 3");
    expect(result.reply).toContain("3 x Zinger Burger Combo");
  });

  it("clears a draft without creating an order", async () => {
    await send("cho mình 1 combo burger zinger");

    expect((await send("hủy đơn")).reply).toContain("hủy đơn nháp");
    expect((await send("xem giỏ hàng")).reply).toContain("trống");
    expect(await listOrders()).toHaveLength(0);
  });

  it("does not create a second order on duplicate confirmation", async () => {
    await send("cho mình 1 combo burger zinger");
    await send("0900000000 địa chỉ 123 Nguyễn Trãi Quận 1");
    await send("không có coupon");
    await send("COD");
    await send("xác nhận");
    const duplicateResult = await send("xác nhận");

    expect(duplicateResult.createdOrderIds).toHaveLength(0);
    expect(duplicateResult.reply).toContain("đã được xác nhận");
    expect(await listOrders()).toHaveLength(1);
  });

  it("recalculates a payment-specific coupon after switching to VNPay", async () => {
    await send("cho mình 2 combo burger zinger");
    await send("COD");
    expect((await send("coupon COD15K")).reply).toContain("Mã COD15K: giảm");
    const result = await send("thanh toán vnpay");

    expect(result.reply).toContain("Mã COD15K chưa áp dụng");
    expect(result.reply).toContain("chỉ áp dụng cho phương thức thanh toán: cod");
  });

  it("replaces one exact draft item with another exact item", async () => {
    await send("cho mình 1 combo burger zinger");
    const result = await send("đổi combo burger zinger thành pepsi tiêu chuẩn");

    expect(result.reply).toContain("đổi Zinger Burger Combo thành Pepsi (Regular)");
    expect(result.reply).toContain("1 x Pepsi (Regular)");
    expect(result.reply).not.toContain("1 x Zinger Burger Combo");
  });

  it("reports an invalid coupon without changing the order total", async () => {
    await send("cho mình 1 combo burger zinger");
    const result = await send("coupon KHONGTONTAI");

    expect(result.reply).toContain("Mã KHONGTONTAI chưa áp dụng");
    expect(result.reply).toContain("mã giảm giá không tồn tại");
    expect(result.reply).toContain("Tổng dự kiến: 99.000");
  });

  it("suggests alternatives when an exact requested item is unavailable", async () => {
    const item = getMenuItem("offline-combo-1-nguoi-combo-burger-zinger-10")!;
    updateMenuItem(item.sku, { stockQuantity: 0, isAvailable: false });
    const result = await send("cho mình 1 combo burger zinger");

    expect(result.reply).toContain("is currently unavailable");
    expect(result.reply).toContain("You could try");
  });

  it("echoes the delivery address for customer verification", async () => {
    await send("cho mình 1 combo burger zinger");
    const result = await send("sdt 0900000000, địa chỉ 123 Nguyễn Trãi, Quận 1");

    expect(result.reply).toContain("Địa chỉ giao hàng: 123 Nguyễn Trãi, Quận 1");
  });

  it("treats bo don as cancelling the current draft", async () => {
    await send("cho mình 1 combo burger zinger");
    const result = await send("bỏ đơn");

    expect(result.reply).toContain("hủy đơn nháp");
    expect((await send("xem giỏ hàng")).reply).toContain("trống");
  });

  it("shows the current draft for a natural order-status question", async () => {
    await send("cho mình 1 combo burger zinger");
    const result = await send("đơn hàng hiện tại của tôi đang có gì");

    expect(result.reply).toContain("Đơn nháp của bạn");
    expect(result.reply).toContain("1 x Zinger Burger Combo");
  });

  it("uses the cart context when changing a shortened item name", async () => {
    await send("cho mình 2 khoai tây chiên vừa");
    const result = await send("sửa lại 1 khoai tây");

    expect(result.reply).toContain("đổi số lượng French Fries (Medium) thành 1");
    expect(result.reply).toContain("1 x French Fries (Medium)");
  });

  it("resolves a shortened follow-up item to the only matching cart item", async () => {
    await send("cho mình 1 khoai tây chiên vừa");
    const result = await send("khoai tây");

    expect(result.reply).toContain("thêm 1 x French Fries (Medium)");
    expect(result.reply).toContain("2 x French Fries (Medium)");
  });

  it("sends a product image only when the customer asks for it", async () => {
    const result = await send("cho xem ảnh khoai tây chiên vừa");

    expect(result.reply).toContain("Đây là hình của French Fries (Medium)");
    expect(result.imageUrls).toHaveLength(1);
    expect(result.imageUrls[0]).toMatch(/^\/assets\/image\//);
    expect((await send("xem giỏ hàng")).reply).toContain("trống");
  });

  it("adds an item using its short menu ID and quantity", async () => {
    const item = getMenuItem("offline-combo-1-nguoi-combo-burger-zinger-10")!;
    const result = await send(`${item.orderId}-2`);

    expect(result.reply).toContain(`Added 2 x ${item.name}`);
    expect(result.reply).toContain(`2 x ${item.name}`);
  });

  it("shows short menu IDs in the menu response", async () => {
    const result = await send("/menu");

    expect(result.reply).toMatch(/\[M[0-9]{3}\]/);
  });

  it("decrements an item when removing an explicit partial quantity", async () => {
    await send("cho mình 3 khoai tây chiên vừa");
    const result = await send("bỏ 1 khoai tây");

    expect(result.reply).toContain("bỏ 1 x French Fries (Medium)");
    expect(result.reply).toContain("2 x French Fries (Medium)");
  });

  it("removes the entire line when no removal quantity is provided", async () => {
    await send("cho mình 3 khoai tây chiên vừa");
    const result = await send("bỏ khoai tây");

    expect(result.reply).toContain("bỏ French Fries (Medium)");
    expect(result.reply).toContain("trống");
  });

  it("merges cart lines when replacing with an item already in the cart", async () => {
    await send("cho mình 1 combo burger zinger và 1 pepsi tiêu chuẩn");
    const result = await send("đổi combo burger zinger thành pepsi tiêu chuẩn");

    expect(result.reply).toContain("2 x Pepsi (Regular)");
    expect(result.reply.match(/Pepsi \(Regular\)/g)).toHaveLength(2);
  });

  it("rejects an unknown short menu ID", async () => {
    const result = await send("M999-2");

    expect(result.reply).toContain("could not find");
    expect((await send("xem giỏ hàng")).reply).toContain("trống");
  });

  it("requires a valid Vietnamese phone before confirmation", async () => {
    await send("cho mình 1 combo burger zinger");
    await send("địa chỉ 123 Nguyễn Trãi Quận 1");
    await send("không có coupon");
    const result = await send("xác nhận");

    expect(result.reply).toContain("số điện thoại hợp lệ");
    expect(await listOrders()).toHaveLength(0);
  });

  it("understands a short negative answer while waiting for coupon", async () => {
    await send("cho mình 1 combo burger zinger");
    await send("0900000000 địa chỉ 123 Nguyễn Trãi Quận 1");
    await send("COD");
    expect((await send("xác nhận")).reply).toContain("Bạn có mã giảm giá không?");

    const result = await send("ko có");

    expect(result.reply).toContain("Bạn muốn thanh toán bằng hình thức nào?");
  });

  it("requires payment selection and includes contact details in the final confirmation", async () => {
    await send("cho mình 1 combo burger zinger");
    await send("0900000000 địa chỉ 123 Nguyễn Trãi Quận 1");
    await send("coupon KFC20");
    expect((await send("xác nhận")).reply).toContain("hình thức thanh toán (COD/VNPay)");
    await send("COD");
    const result = await send("xác nhận");

    expect(result.reply).toContain("Thanh toán: COD");
    expect(result.reply).toContain("Số điện thoại: 0900000000");
    expect(result.reply).toContain("Địa chỉ giao hàng: 123 Nguyễn Trãi Quận 1");
  });

  it("collects phone, address, and payment from one checkout message", async () => {
    await send("cho mình 1 combo burger zinger");
    const summary = await send("0900000000, địa chỉ 123 Nguyễn Trãi Quận 1, COD");

    expect(summary.reply).toContain("Thanh toán: COD");
    expect(summary.reply).toContain("Địa chỉ giao hàng: 123 Nguyễn Trãi Quận 1");
    expect(summary.reply).not.toContain("Quận 1, COD");
    expect((await send("xác nhận")).reply).toContain("Bạn có mã giảm giá không?");
  });

  it("accumulates checkout fields sent across multiple messages", async () => {
    await send("cho mình 1 combo burger zinger");
    await send("0900000000");
    await send("địa chỉ 123 Nguyễn Trãi Quận 1");
    const summary = await send("VNPay");

    expect(summary.reply).toContain("Thanh toán: VNPay");
    expect(summary.reply).toContain("Địa chỉ giao hàng: 123 Nguyễn Trãi Quận 1");
    expect(summary.reply).not.toContain("Still needed:");
  });

  it("shows the supplied phone number in the draft summary", async () => {
    await send("cho mình 1 combo burger zinger");
    const summary = await send("sdt 0900000000");

    expect(summary.reply).toContain("Số điện thoại: 0900000000");
  });

  it("recognizes a standalone street address while checkout data is pending", async () => {
    await send("cho mình 1 combo burger zinger");
    const summary = await send("123 Nguyễn Trãi Quận 1");

    expect(summary.reply).toContain("Địa chỉ giao hàng: 123 Nguyễn Trãi Quận 1");
  });

  it("does not treat a numeric food request as a standalone address", async () => {
    await send("cho mình 1 combo burger zinger");
    const result = await send("2 gà rán");

    expect(result.reply).not.toContain("Delivery address: 2 gà rán");
    expect(result.reply).toContain("\"ga ran\"");
  });

  it("asks a checkout-focused follow-up instead of a generic fallback for uncertain data", async () => {
    await send("cho mình 1 combo burger zinger");
    const result = await send("nhà mình gần trường học");

    expect(result.reply).toContain("Mình chưa nhận ra đủ thông tin giao hàng");
    expect(result.reply).toContain("sđt của bạn, địa chỉ giao hàng, COD");
  });

  it("does not hardcode a saved delivery address", async () => {
    await send("cho mình 1 combo burger zinger");
    const result = await send("giao về địa chỉ cũ");

    expect(result.reply).toContain("chưa có address book");
    expect(result.reply).toContain("gửi lại địa chỉ giao hàng");
    expect(result.reply).not.toContain("123 Nguyễn Trãi");
  });

  it("supports multiple short IDs with separate quantities", async () => {
    const combo = getMenuItem("offline-combo-1-nguoi-combo-burger-zinger-10")!;
    const pepsi = getMenuItem("offline-thuc-uong-trang-mieng-pepsi-tieu-chuan-3")!;
    const result = await send(`${combo.orderId}-2 và ${pepsi.orderId}-3`);

    expect(result.reply).toContain(`2 x ${combo.name}`);
    expect(result.reply).toContain(`3 x ${pepsi.name}`);
  });

  it("understands a spaced 7 up shorthand and uses the standard size", async () => {
    const result = await send("2 7 up");

    expect(result.reply).toContain("Added 2 x 7Up (Regular)");
    expect(result.reply).toContain("2 x 7Up (Regular)");
  });

  it("understands the compact 7up shorthand with an add command", async () => {
    const result = await send("thêm 3 7up");

    expect(result.reply).toContain("thêm 3 x 7Up (Regular)");
  });

  it("adds known items and asks a focused follow-up for an ambiguous item in the same message", async () => {
    const result = await send("1 cơm trắng, 2 7 up, 2 gà rán");

    expect(result.reply).toContain("thêm 1 x Steamed Rice");
    expect(result.reply).toContain("thêm 2 x 7Up (Regular)");
    expect(result.reply).toContain("Mình chưa chắc \"ga ran\" là món nào");
    expect(result.reply).toContain("Bạn muốn chọn món nào dưới đây?");
  });

  it("matches menu names without case sensitivity", async () => {
    const result = await send("1 CƠM TRẮNG");

    expect(result.reply).toContain("thêm 1 x Steamed Rice");
  });

  it("matches menu names without Vietnamese tones", async () => {
    const result = await send("1 com trang");

    expect(result.reply).toContain("Added 1 x Steamed Rice");
  });

  it("matches a sufficiently specific partial product name", async () => {
    const result = await send("1 combo burger zing");

    expect(result.reply).toContain("Added 1 x Zinger Burger Combo");
  });

  it("tolerates a one-character typo in a specific product name", async () => {
    const result = await send("1 combo burger zingre");

    expect(result.reply).toContain("Added 1 x Zinger Burger Combo");
  });

  it("does not auto-select a product for a generic fuzzy query", async () => {
    const result = await send("2 ga ran");

    expect(result.reply).toContain("Did you mean one of these items?");
    expect((await send("xem giỏ hàng")).reply).toContain("trống");
  });

  it("does not treat the beginning of order as an address marker", async () => {
    await send("cho mình 2 7 up lon");
    await send("Mình muốn order thêm món gà, menu có các món nào");
    const result = await send("M026 2 phần");

    expect(result.reply).not.toContain("Delivery address: rder");
    expect(result.reply).toContain("địa chỉ giao hàng");
  });
});

async function send(text: string, now = OPEN_TIME) {
  return processChatMessage({
    chatId: "chat-1",
    displayName: "Peter",
    text,
    now
  });
}
