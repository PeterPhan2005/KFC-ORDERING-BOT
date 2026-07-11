import { config } from "../config.js";
import { coupons } from "../data/coupons.js";
import { AppError } from "../lib/app-error.js";
import type { CustomerInfo, MenuItem, Order, PaymentMethod, QuoteInputItem } from "../types.js";
import {
  findMenuItemByText,
  getMenuItem,
  getMenuItemByOrderId,
  listCheapestItems,
  listGroupCombos,
  listHotCombos,
  listMenuItems,
  listUnavailableItems,
  normalizeSearchText,
  searchMenuItems,
  suggestMenuItemsForText,
  suggestAlternatives
} from "./menu.js";
import { createOrder } from "./orders.js";
import { createQuote } from "./pricing.js";
import { getStoreHours } from "./store.js";
import { interpretChatMessageWithLlm, isLlmConfigured } from "./llm.js";

type ConversationStatus = "IDLE" | "BUILDING_ORDER" | "AWAITING_CONFIRMATION" | "CONFIRMED";

type DraftCustomer = {
  name: string;
  phone?: string;
  address?: string;
};

type DraftOrder = {
  items: QuoteInputItem[];
  customer: DraftCustomer;
  couponCode?: string;
  couponHandled: boolean;
  paymentMethod?: PaymentMethod;
  notes?: string;
  loyalty?: {
    status: "verified";
    phone: string;
    points: number;
    tier: string;
  };
};

type ConversationSession = {
  chatId: string;
  locale: "vi" | "en";
  status: ConversationStatus;
  draft: DraftOrder;
  lastOrderId?: string;
  pendingQuestion?: "checkout" | "coupon" | "payment" | "loyalty";
  updatedAt: string;
};

export type ChatMessageInput = {
  chatId: string;
  displayName: string;
  text: string;
  now?: Date;
};

export type ChatMessageResult = {
  reply: string;
  createdOrderIds: string[];
  imageUrls: string[];
};

type ChatProcessingOptions = {
  allowLlm?: boolean;
};

type RequestedItem = {
  item: MenuItem;
  quantity: number;
  isQuantityExplicit: boolean;
};

const sessions = new Map<string, ConversationSession>();

export async function processChatMessage(input: ChatMessageInput, options: ChatProcessingOptions = {}): Promise<ChatMessageResult> {
  const allowLlm = options.allowLlm ?? true;
  const text = input.text.trim();
  const normalizedText = normalizeSearchText(text);
  const session = getOrCreateSession(input.chatId, input.displayName);
  const requestedLocale = getLanguageSwitchLocale(normalizedText);

  if (requestedLocale) {
    session.locale = requestedLocale;
    session.updatedAt = new Date().toISOString();
    return reply(formatLanguageSwitchConfirmation(requestedLocale));
  }

  session.locale = detectLocale(text, normalizedText, session.locale);
  session.updatedAt = new Date().toISOString();

  if (!text) {
    return reply(
      session.locale === "vi"
        ? "Mình chỉ nhận đơn qua tin nhắn chữ. Bạn gõ /menu để xem món nhé."
        : "I can only process text messages. Type /menu to view the menu."
    );
  }

  if (isLanguageHelpIntent(normalizedText)) {
    return reply(formatLanguageHelp(session.locale));
  }

  const contactUpdate = extractContactInfo(text, session);

  if (contactUpdate.phone) {
    session.draft.customer.phone = contactUpdate.phone;
  }

  if (contactUpdate.address) {
    session.draft.customer.address = contactUpdate.address;
  }

  if (isLegacyAddressIntent(normalizedText)) {
    return reply(formatLegacyAddressUnavailable(session));
  }

  if (session.pendingQuestion === "loyalty" && contactUpdate.phone) {
    return reply(handleLoyaltyLookup(session, contactUpdate.phone));
  }

  if (isGreeting(normalizedText)) {
    return reply(
      session.locale === "vi"
        ? [
            "Chào bạn, mình đây.",
            "Bạn muốn mình gợi ý món, xem menu hay đặt luôn vài phần KFC?",
            "Cứ nhắn tự nhiên kiểu \"em muốn burger cay với pepsi\" hoặc gõ /menu để xem thực đơn nhé."
          ].join("\n")
        : [
            "Hi, I am here.",
            "Would you like a menu, a combo suggestion, or help placing an order?",
            "You can type naturally, like \"I want a spicy burger with Pepsi\", or send /menu."
          ].join("\n")
    );
  }

  if (isCancelDraftIntent(normalizedText)) {
    return handleCancelDraft(session);
  }

  if (isHumanHandoffIntent(normalizedText)) {
    return reply(formatHandoffResponse(session, "Khách yêu cầu nói chuyện với nhân viên."));
  }

  if (isLoyaltyInquiryIntent(normalizedText)) {
    const phone = contactUpdate.phone ?? session.draft.customer.phone;

    if (!phone) {
      session.pendingQuestion = "loyalty";
      return reply(
        session.locale === "vi"
          ? "Mình có thể kiểm tra điểm thành viên, nhưng cần xác thực bằng số điện thoại trước. Bạn gửi số điện thoại thành viên giúp mình nhé."
          : "I can check loyalty points, but I need your member phone number first."
      );
    }

    return reply(handleLoyaltyLookup(session, phone));
  }

  if (isConfirmIntent(normalizedText)) {
    return handleConfirmOrder(session, input.now ?? new Date());
  }

  if (isImageIntent(normalizedText)) {
    return handleImageRequest(session, text);
  }

  if (isMenuIntent(normalizedText)) {
    return reply(formatMenuResponse(text, session.locale));
  }

  const couponCode = extractCouponCode(text);

  if (couponCode) {
    session.draft.couponCode = couponCode;
    session.draft.couponHandled = true;
    session.pendingQuestion = undefined;
    return reply(formatDraftResponse(session));
  }

  if (isVoucherOptimizerIntent(normalizedText)) {
    return reply(handleVoucherOptimizer(session));
  }

  const paymentMethod = extractPaymentMethod(normalizedText);

  if (paymentMethod) {
    session.draft.paymentMethod = paymentMethod;
    session.pendingQuestion = undefined;
    return reply(formatDraftResponse(session));
  }

  if (isSkipCouponIntent(normalizedText) || (session.pendingQuestion === "coupon" && isBareNegativeIntent(normalizedText))) {
    session.draft.couponCode = undefined;
    session.draft.couponHandled = true;
    session.pendingQuestion = "payment";
    return reply(formatPaymentQuestion(session.locale));
  }

  const notes = extractOrderNotes(text);

  if (notes) {
    session.draft.notes = notes;
    return reply([session.locale === "vi" ? "Mình đã thêm ghi chú vào đơn." : "I added your note to the order.", formatDraftResponse(session)].join("\n\n"));
  }

  const recommendation = getRecommendationResponse(normalizedText, session.locale);

  if (recommendation) {
    return reply(recommendation);
  }

  if (isShowCartIntent(normalizedText)) {
    return reply(formatDraftResponse(session));
  }

  if (isRemoveIntent(normalizedText)) {
    return handleRemoveItems(session, text);
  }

  if (isChangeIntent(normalizedText)) {
    return handleChangeItems(session, text);
  }

  const requestedItems = extractRequestedItems(text, session);

  if (requestedItems.length > 0) {
    const result = handleAddItems(session, requestedItems, input.now ?? new Date());
    const clarification = formatUnresolvedSegments(text, session);

    return clarification ? { ...result, reply: `${result.reply}\n\n${clarification}` } : result;
  }

  if (isOrderRequestIntent(normalizedText) || isMenuCodeRequest(text)) {
    const llmResult = allowLlm ? await handleLlmInterpretation(input, session, text, normalizedText) : undefined;

    if (llmResult) {
      return llmResult;
    }

    return reply(formatUnresolvedItemResponse(text, session.locale));
  }

  if (contactUpdate.phone || contactUpdate.address) {
    return reply(formatDraftResponse(session));
  }

  if (session.pendingQuestion === "checkout") {
    const llmResult = allowLlm ? await handleLlmInterpretation(input, session, text, normalizedText) : undefined;

    if (llmResult) {
      return llmResult;
    }

    return reply(
      [
        session.locale === "vi"
          ? "Mình chưa nhận ra đủ thông tin giao hàng trong tin nhắn đó."
          : "I could not confidently identify the checkout details in that message.",
        session.locale === "vi"
          ? `Bạn gửi thêm giúp mình: ${formatMissingFields(getMissingCheckoutFields(session.draft), session.locale)}.`
          : `Please send the missing details: ${getMissingCheckoutFields(session.draft).join(", ")}.`,
        session.locale === "vi"
          ? "Ví dụ: \"sđt của bạn, địa chỉ giao hàng, COD\"."
          : "Example: \"your phone number, delivery address, COD\"."
      ].join("\n")
    );
  }

  const llmResult = allowLlm ? await handleLlmInterpretation(input, session, text, normalizedText) : undefined;

  if (llmResult) {
    return llmResult;
  }

  return reply(
    session.locale === "vi"
      ? [
          "Mình chưa hiểu ý bạn.",
          "Bạn có thể gõ /menu, hỏi \"món rẻ nhất\", \"combo hot\", hoặc nhắn kiểu \"thêm 1 pepsi\"."
        ].join("\n")
      : [
          "I did not understand that.",
          "Type /menu, ask for \"cheapest items\" or \"hot combos\", or order with \"add 1 Pepsi\"."
        ].join("\n")
  );
}

export function clearConversationSessionsForTest() {
  sessions.clear();
}

function handleLoyaltyLookup(session: ConversationSession, phone: string): string {
  const loyalty = createMockLoyaltyProfile(phone);
  session.draft.customer.phone = phone;
  session.draft.loyalty = loyalty;
  session.pendingQuestion = undefined;

  return session.locale === "vi"
    ? [
        `Mình đã xác thực thành viên qua số ${phone}.`,
        `Hạng hiện tại: ${loyalty.tier}.`,
        `Điểm khả dụng: ${loyalty.points.toLocaleString("vi-VN")} điểm.`,
        loyalty.points >= 500
          ? "Bạn có đủ điểm để đổi ưu đãi trong lần mua này nếu loyalty API thật hỗ trợ redeem."
          : "Bạn chưa đủ nhiều điểm để đổi ưu đãi lớn, nhưng vẫn có thể dùng voucher nếu đủ điều kiện."
      ].join("\n")
    : [
        `I verified the member phone ${phone}.`,
        `Current tier: ${loyalty.tier}.`,
        `Available points: ${loyalty.points.toLocaleString("en-US")}.`
      ].join("\n");
}

function handleVoucherOptimizer(session: ConversationSession): string {
  if (session.draft.items.length === 0) {
    return session.locale === "vi"
      ? "Bạn thêm món vào giỏ trước nhé, rồi mình sẽ chọn voucher tiết kiệm nhất dựa trên tổng đơn."
      : "Add items to your cart first, then I can choose the best voucher for the order.";
  }

  const bestVoucher = findBestVoucher(session);

  if (!bestVoucher) {
    session.draft.couponHandled = true;
    return session.locale === "vi"
      ? "Mình đã kiểm tra các voucher hiện có nhưng chưa có mã nào áp dụng được cho giỏ này."
      : "I checked the available vouchers, but none can be applied to this cart.";
  }

  session.draft.couponCode = bestVoucher.code;
  session.draft.couponHandled = true;
  session.pendingQuestion = undefined;

  return [
    session.locale === "vi"
      ? `Mình đã chọn voucher ${bestVoucher.code} vì tiết kiệm tốt nhất cho giỏ hiện tại: giảm ${formatVnd(bestVoucher.discount)}.`
      : `I selected voucher ${bestVoucher.code} because it saves the most for this cart: ${formatVnd(bestVoucher.discount)} off.`,
    formatDraftResponse(session)
  ].join("\n\n");
}

function formatHandoffResponse(session: ConversationSession, reason: string): string {
  const summary = createHandoffSummary(session, reason);

  return session.locale === "vi"
    ? [
        "Mình sẽ chuyển cuộc trò chuyện này cho nhân viên hỗ trợ.",
        "Tóm tắt để nhân viên tiếp tục đúng bước:",
        `- Lý do: ${summary.reason}`,
        `- Trạng thái: ${summary.status}`,
        `- Giỏ hàng: ${summary.cart}`,
        `- Voucher: ${summary.coupon}`,
        `- Loyalty: ${summary.loyalty}`,
        `- Còn thiếu: ${summary.missingFields}`,
        `- Gợi ý bước tiếp theo: ${summary.nextAction}`
      ].join("\n")
    : [
        "I will hand this conversation to a staff member.",
        "Context for the agent:",
        `- Reason: ${summary.reason}`,
        `- Status: ${summary.status}`,
        `- Cart: ${summary.cart}`,
        `- Voucher: ${summary.coupon}`,
        `- Loyalty: ${summary.loyalty}`,
        `- Missing: ${summary.missingFields}`,
        `- Suggested next action: ${summary.nextAction}`
      ].join("\n");
}

async function handleLlmInterpretation(
  input: ChatMessageInput,
  session: ConversationSession,
  text: string,
  normalizedText: string
): Promise<ChatMessageResult | undefined> {
  if (!isLlmConfigured()) {
    return undefined;
  }

  const interpretation = await interpretChatMessageWithLlm({
    locale: session.locale,
    userText: text,
    draftSummary: formatLlmDraftSummary(session),
    menuContext: formatLlmMenuContext(normalizedText),
    missingFields: getMissingCheckoutFields(session.draft),
    pendingQuestion: session.pendingQuestion
  });

  if (!interpretation || interpretation.action === "none") {
    return undefined;
  }

  if (interpretation.action === "reply") {
    return reply(interpretation.reply);
  }

  if (normalizeSearchText(interpretation.text) === normalizedText) {
    return undefined;
  }

  return processChatMessage(
    {
      ...input,
      text: interpretation.text
    },
    {
      allowLlm: false
    }
  );
}

function handleAddItems(session: ConversationSession, requestedItems: RequestedItem[], now: Date): ChatMessageResult {
  if (!isStoreOpen(now)) {
    return reply(formatClosedStoreMessage(now, session.locale));
  }

  if (session.status === "CONFIRMED") {
    resetDraft(session);
  }

  session.status = "BUILDING_ORDER";
  const lines: string[] = [];

  for (const requestedItem of requestedItems) {
    const stockError = getStockError(requestedItem.item, requestedItem.quantity);

    if (stockError) {
      lines.push(stockError);
      continue;
    }

    const existingItem = session.draft.items.find((item) => item.sku === requestedItem.item.sku);

    if (existingItem) {
      const nextQuantity = existingItem.quantity + requestedItem.quantity;
      const nextStockError = getStockError(requestedItem.item, nextQuantity);

      if (nextStockError) {
        lines.push(nextStockError);
        continue;
      }

      existingItem.quantity = nextQuantity;
    } else {
      session.draft.items.push({
        sku: requestedItem.item.sku,
        quantity: requestedItem.quantity
      });
    }

    lines.push(formatAddedLine(requestedItem.item, requestedItem.quantity, session.locale));
  }

  return reply([...lines, formatDraftResponse(session)].join("\n\n"));
}

function handleRemoveItems(session: ConversationSession, text: string): ChatMessageResult {
  if (session.draft.items.length === 0) {
    return reply(formatEmptyCart(session.locale));
  }

  const requestedItems = extractRequestedItems(text, session);

  if (requestedItems.length === 0) {
    return reply(
      session.locale === "vi"
        ? "Bạn muốn bỏ món nào? Ví dụ: \"bỏ Pepsi\" hoặc \"bỏ combo burger zinger\"."
        : "Which item would you like to remove? For example: \"remove Pepsi\" or \"remove Zinger Burger\"."
    );
  }

  const removedLines: string[] = [];

  for (const requestedItem of requestedItems) {
    const existingIndex = session.draft.items.findIndex((item) => item.sku === requestedItem.item.sku);

    if (existingIndex === -1) {
      removedLines.push(
        session.locale === "vi"
          ? `${requestedItem.item.name} không có trong giỏ hiện tại.`
          : `${requestedItem.item.name} is not in your cart.`
      );
      continue;
    }

    const existingItem = session.draft.items[existingIndex];

    if (requestedItem.isQuantityExplicit && requestedItem.quantity < existingItem.quantity) {
      existingItem.quantity -= requestedItem.quantity;
      removedLines.push(formatRemovedLine(requestedItem.item, requestedItem.quantity, session.locale));
    } else {
      session.draft.items.splice(existingIndex, 1);
      removedLines.push(formatRemovedLine(requestedItem.item, undefined, session.locale));
    }
  }

  session.status = session.draft.items.length > 0 ? "BUILDING_ORDER" : "IDLE";
  return reply([...removedLines, formatDraftResponse(session)].join("\n\n"));
}

function handleChangeItems(session: ConversationSession, text: string): ChatMessageResult {
  if (session.draft.items.length === 0) {
    return reply(session.locale === "vi" ? "Giỏ hàng đang trống. Bạn muốn đặt món nào?" : "Your cart is empty. What would you like to order?");
  }

  const changeParts = text.split(/\s+(?:thành|thanh|sang|to|with)\s+/i);

  if (changeParts.length === 2) {
    const oldItems = extractRequestedItems(changeParts[0], session);
    const newItems = extractRequestedItems(changeParts[1], session);
    const oldItem = oldItems[0];

    if (!oldItem) {
      return reply(session.locale === "vi" ? "Mình chưa nhận ra món bạn muốn đổi." : "I could not identify the item you want to change.");
    }

    const existingItem = session.draft.items.find((item) => item.sku === oldItem.item.sku);

    if (!existingItem) {
      return reply(session.locale === "vi" ? `${oldItem.item.name} không có trong giỏ hiện tại.` : `${oldItem.item.name} is not in your cart.`);
    }

    if (newItems.length > 0) {
      const newItem = newItems[0];
      const existingNewItem = session.draft.items.find((item) => item.sku === newItem.item.sku);
      const nextQuantity = (existingNewItem?.quantity ?? 0) + newItem.quantity;
      const stockError = getStockError(newItem.item, nextQuantity);

      if (stockError) {
        return reply(stockError);
      }

      session.draft.items = session.draft.items.filter((item) => item.sku !== oldItem.item.sku);
      const replacementItem = session.draft.items.find((item) => item.sku === newItem.item.sku);

      if (replacementItem) {
        replacementItem.quantity += newItem.quantity;
      } else {
        session.draft.items.push({ sku: newItem.item.sku, quantity: newItem.quantity });
      }
      session.status = "BUILDING_ORDER";
      return reply([formatChangedItemLine(oldItem.item, newItem.item, session.locale), formatDraftResponse(session)].join("\n\n"));
    }

    const quantity = extractQuantity(changeParts[1]);
    const stockError = getStockError(oldItem.item, quantity);

    if (stockError) {
      return reply(stockError);
    }

    existingItem.quantity = quantity;
    session.status = "BUILDING_ORDER";
    return reply([formatChangedQuantityLine(oldItem.item, quantity, session.locale), formatDraftResponse(session)].join("\n\n"));
  }

  const requestedItems = extractRequestedItems(text, session);

  if (requestedItems.length >= 2) {
    const [oldItem, newItem] = requestedItems;
    session.draft.items = session.draft.items.filter((item) => item.sku !== oldItem.item.sku);
    return handleAddItems(session, [newItem], new Date());
  }

  if (requestedItems.length === 1) {
    const requestedItem = requestedItems[0];
    const existingItem = session.draft.items.find((item) => item.sku === requestedItem.item.sku);

    if (!existingItem) {
      return handleAddItems(session, [requestedItem], new Date());
    }

    const stockError = getStockError(requestedItem.item, requestedItem.quantity);

    if (stockError) {
      return reply(stockError);
    }

    existingItem.quantity = requestedItem.quantity;
    session.status = "BUILDING_ORDER";

    return reply([formatChangedQuantityLine(requestedItem.item, requestedItem.quantity, session.locale), formatDraftResponse(session)].join("\n\n"));
  }

  return reply(
    session.locale === "vi"
      ? "Bạn muốn đổi món nào? Ví dụ: \"sửa Pepsi thành 2\" hoặc \"đổi Pepsi thành 7Up\"."
      : "Which item would you like to change? For example: \"change Pepsi to 2\" or \"replace Pepsi with 7Up\"."
  );
}

function handleCancelDraft(session: ConversationSession): ChatMessageResult {
  if (session.status === "CONFIRMED" && session.lastOrderId) {
    return reply(
      session.locale === "vi"
        ? `Đơn ${session.lastOrderId} đã được xác nhận nên mình không thể hủy trực tiếp trong bot.`
        : `Order ${session.lastOrderId} is confirmed and can no longer be cancelled in this bot.`
    );
  }

  if (session.draft.items.length === 0) {
    return reply(session.locale === "vi" ? "Bạn chưa có đơn nháp để hủy." : "You do not have a draft order to cancel.");
  }

  resetDraft(session);
  return reply(
    session.locale === "vi"
      ? "Mình đã hủy đơn nháp hiện tại. Bạn gõ /menu để bắt đầu đơn mới nhé."
      : "Your current draft order has been cancelled. Type /menu to start a new order."
  );
}

async function handleConfirmOrder(session: ConversationSession, now: Date): Promise<ChatMessageResult> {
  if (session.status === "CONFIRMED" && session.lastOrderId) {
    return reply(
      session.locale === "vi"
        ? `Đơn ${session.lastOrderId} đã được xác nhận. Mình không thể sửa hoặc hủy đơn này trong bot.`
        : `Order ${session.lastOrderId} is confirmed. I cannot change or cancel it in this bot.`
    );
  }

  if (session.draft.items.length === 0) {
    return reply(session.locale === "vi" ? "Giỏ hàng đang trống. Bạn muốn đặt món nào?" : "Your cart is empty. What would you like to order?");
  }

  if (!isStoreOpen(now)) {
    return reply(formatClosedStoreMessage(now, session.locale));
  }

  const missingFields = getMissingCheckoutFields(session.draft);

  if (missingFields.length > 0) {
    session.pendingQuestion = "checkout";
    return reply(
      [
        session.locale === "vi" ? "Mình cần thêm thông tin trước khi chốt đơn." : "I need more information before I can confirm the order.",
        session.locale === "vi" ? `Còn thiếu: ${formatMissingFields(missingFields, session.locale)}.` : `Missing: ${missingFields.join(", ")}.`,
        session.locale === "vi"
          ? "Bạn có thể gửi một lần theo mẫu: \"sđt của bạn, địa chỉ giao hàng, COD\", hoặc gửi từng thông tin cũng được."
          : "You can send all three details in one message, for example: \"your phone number, delivery address, COD\"; or send them across multiple messages."
      ].join("\n")
    );
  }

  if (!session.draft.couponHandled) {
    session.pendingQuestion = "coupon";
    return reply(
      session.locale === "vi"
        ? [
            "Bạn có mã giảm giá không?",
            "Nếu có, gửi theo mẫu: \"coupon KFC20\".",
            "Nếu không có, bạn trả lời \"không\" nhé."
          ].join("\n")
        : [
            "Do you have a coupon code?",
            "If you do, send it like this: \"coupon KFC20\".",
            "If you do not have one, reply \"no\"."
          ].join("\n")
    );
  }

  if (!session.draft.paymentMethod) {
    session.pendingQuestion = "payment";
    return reply(formatPaymentQuestion(session.locale));
  }

  try {
    const order = await createOrder({
      items: session.draft.items,
      couponCode: session.draft.couponCode,
      paymentMethod: session.draft.paymentMethod,
      customer: session.draft.customer as CustomerInfo,
      notes: [session.draft.notes, `Telegram chatbot order for ${session.chatId}`].filter(Boolean).join(" | ")
    });

    session.status = "CONFIRMED";
    session.pendingQuestion = undefined;
    session.lastOrderId = order.id;
    session.draft.items = [];

    return {
      reply: formatConfirmedOrder(order, session.locale),
      createdOrderIds: [order.id],
      imageUrls: []
    };
  } catch (error) {
    return reply(formatOrderError(error, session.locale));
  }
}

function formatDraftResponse(session: ConversationSession): string {
  if (session.draft.items.length === 0) {
    return formatEmptyCart(session.locale);
  }

  try {
    const quote = createQuote({
      items: session.draft.items,
      couponCode: session.draft.couponCode,
      paymentMethod: session.draft.paymentMethod,
      deliveryAddress: session.draft.customer.address
    });
    const missingFields = getMissingCheckoutFields(session.draft);
    session.status = missingFields.length === 0 ? "AWAITING_CONFIRMATION" : "BUILDING_ORDER";

    if (missingFields.length > 0) {
      session.pendingQuestion = "checkout";
    } else if (session.pendingQuestion === "checkout") {
      session.pendingQuestion = undefined;
    }

    return [
      session.locale === "vi" ? "Đơn nháp của bạn:" : "Your draft order:",
      ...quote.items.map((item) => `- ${item.quantity} x ${item.name}: ${formatVnd(item.lineTotal)}`),
      `${session.locale === "vi" ? "Tạm tính" : "Subtotal"}: ${formatVnd(quote.subtotal)}`,
      quote.coupon
        ? quote.coupon.isApplied
          ? session.locale === "vi"
            ? `Mã ${quote.coupon.code}: giảm ${formatVnd(quote.coupon.discount)}.`
            : `Coupon ${quote.coupon.code}: saved ${formatVnd(quote.coupon.discount)}.`
          : session.locale === "vi"
            ? `Mã ${quote.coupon.code} chưa áp dụng được: ${formatCouponReason(quote.coupon.reason, session.locale)}`
            : `Coupon ${quote.coupon.code} was not applied: ${quote.coupon.reason}`
        : undefined,
      `${session.locale === "vi" ? "Phí giao hàng" : "Delivery fee"}: ${formatVnd(quote.deliveryFee)}`,
      `${session.locale === "vi" ? "Tổng dự kiến" : "Estimated total"}: ${formatVnd(quote.total)}`,
      `${session.locale === "vi" ? "Thanh toán" : "Payment"}: ${session.draft.paymentMethod ? formatPaymentMethod(session.draft.paymentMethod) : session.locale === "vi" ? "Chưa chọn (COD/VNPay)" : "Not selected (COD/VNPay)"}.`,
      session.draft.customer.phone ? `${session.locale === "vi" ? "Số điện thoại" : "Phone"}: ${session.draft.customer.phone}.` : undefined,
      session.draft.customer.address ? `${session.locale === "vi" ? "Địa chỉ giao hàng" : "Delivery address"}: ${session.draft.customer.address}.` : undefined,
      session.draft.loyalty
        ? session.locale === "vi"
          ? `Thành viên: ${session.draft.loyalty.tier}, ${session.draft.loyalty.points.toLocaleString("vi-VN")} điểm.`
          : `Member: ${session.draft.loyalty.tier}, ${session.draft.loyalty.points.toLocaleString("en-US")} points.`
        : undefined,
      session.draft.notes ? `${session.locale === "vi" ? "Ghi chú" : "Note"}: ${session.draft.notes}.` : undefined,
      missingFields.length > 0
        ? session.locale === "vi"
          ? `Bạn gửi thêm giúp mình: ${formatMissingFields(missingFields, session.locale)}.`
          : `Still needed: ${missingFields.join(", ")}.`
        : session.locale === "vi"
          ? "Nếu thông tin đúng, bạn nhắn \"xác nhận\" để chốt đơn. Đơn đã chốt sẽ không hủy trực tiếp trong bot được."
          : "If everything is correct, reply \"confirm\". Confirmed orders cannot be cancelled in this bot."
    ].filter(Boolean).join("\n");
  } catch (error) {
    return formatOrderError(error, session.locale);
  }
}

function formatMenuResponse(text: string, locale: ConversationSession["locale"]): string {
  const normalizedText = normalizeSearchText(text);
  const searchQuery = normalizedText.replace(/\b(menu|thuc don|xem|co gi|mon|show|view|what|items)\b/g, "").trim();

  if (searchQuery.length >= 3) {
    const matches = searchMenuItems(searchQuery, 8);

    if (matches.length > 0) {
      return [
        locale === "vi" ? "Mình tìm thấy các món này:" : "I found these items:",
        ...matches.map(formatMenuLine),
        locale === "vi" ? "Bạn muốn thêm món nào vào giỏ?" : "Which item would you like to add?"
      ].join("\n");
    }
  }

  const categories = [...new Set(listMenuItems().map((item) => item.categoryName))].slice(0, 8);
  const featuredItems = listHotCombos(5);

  return [
    locale === "vi" ? "Các nhóm món KFC:" : "KFC menu categories:",
    ...categories.map((category) => `- ${category}`),
    "",
    locale === "vi" ? "Món đang nổi bật:" : "Featured items:",
    ...featuredItems.map(formatMenuLine),
    locale === "vi"
      ? "Bạn có thể hỏi \"món rẻ nhất\", \"combo hot\", hoặc đặt luôn bằng \"2 combo burger zinger\"."
      : "Ask for \"cheapest items\" or \"hot combos\", or order with \"2 Zinger Burger Combos\"."
  ].join("\n");
}

function getRecommendationResponse(normalizedText: string, locale: ConversationSession["locale"]): string | undefined {
  const budgetRecommendation = getBudgetRecommendationResponse(normalizedText, locale);

  if (budgetRecommendation) {
    return budgetRecommendation;
  }

  if (containsAny(normalizedText, ["het mon", "mon nao het", "sold out", "unavailable", "out of stock"])) {
    const unavailableItems = listUnavailableItems(8);

    if (unavailableItems.length === 0) {
      return locale === "vi"
        ? "Hiện chưa có món nào hết hàng. Bạn muốn xem menu hay đặt món luôn?"
        : "No items are currently unavailable. Would you like to view the menu or place an order?";
    }

    return [locale === "vi" ? "Các món hiện không khả dụng:" : "Unavailable items:", ...unavailableItems.map(formatMenuLine)].join("\n");
  }

  if (containsAny(normalizedText, ["spicy", "hot food", "something hot", "something spicy", "smth spicy", "cay", "do cay"])) {
    const spicyItems = listMenuItems()
      .filter((item) => item.isAvailable && item.stockQuantity > 0)
      .filter((item) => /pepper lime|garlic fish sauce|zinger|chicken yo/i.test(item.name))
      .slice(0, 6);

    return [
      locale === "vi" ? "Một vài món cay hợp ý bạn:" : "Spicy recommendations:",
      ...spicyItems.map(formatMenuLine),
      locale === "vi" ? "Bạn gửi mã món và số lượng để mình thêm vào giỏ nhé." : "Tell me an item ID and quantity to add it."
    ].join("\n");
  }

  if (containsAny(normalizedText, [
    "re nhat",
    "gia re",
    "duoi 100",
    "mon re",
    "cheapest",
    "cheap",
    "lowest price",
    "lowest priced",
    "least expensive",
    "low price",
    "budget"
  ])) {
    return [locale === "vi" ? "Các món giá mềm hiện có:" : "Current cheapest items:", ...listCheapestItems(6).map(formatMenuLine)].join("\n");
  }

  if (containsAny(normalizedText, ["which price", "better price", "best value", "value for money", "best deal"])) {
    return [
      locale === "vi" ? "Nếu muốn tối ưu giá, bạn có thể cân nhắc các món này:" : "For the best value, these current deals are worth considering:",
      ...listHotCombos(6).map(formatMenuLine),
      locale === "vi" ? "Bạn cũng có thể hỏi \"món rẻ nhất\" để xem lựa chọn thấp giá hơn." : "You can also ask for \"lowest price items\" to see the cheapest options."
    ].join("\n");
  }

  if (containsAny(normalizedText, ["5 10", "5 den 10", "nhom", "nhieu nguoi", "10 nguoi", "combo nhom", "group combo", "for a group", "large group"])) {
    return [locale === "vi" ? "Combo nhóm phù hợp đi nhiều người:" : "Group combos for larger parties:", ...listGroupCombos(5).map(formatMenuLine)].join("\n");
  }

  if (containsAny(normalizedText, ["combo hot", "hot", "uu dai", "deal", "goi y", "recommend", "suggestion"])) {
    return [locale === "vi" ? "Combo và ưu đãi mình gợi ý:" : "Recommended combos and deals:", ...listHotCombos(6).map(formatMenuLine)].join("\n");
  }

  if (containsAny(normalizedText, ["chon giup", "chon cho", "lua giup", "an gi", "nen an", "goi y giup", "pick for me", "choose for me"])) {
    return [
      locale === "vi" ? "Mình gợi ý vài lựa chọn dễ ăn:" : "Here are a few easy picks:",
      ...listHotCombos(4).map(formatMenuLine),
      locale === "vi" ? "Bạn nhắn mã món và số lượng, ví dụ M010-1, để mình thêm vào giỏ nhé." : "Send the item ID and quantity, for example M010-1, to add it."
    ].join("\n");
  }

  if (containsAny(normalizedText, ["gio mo cua", "may gio", "dong cua", "mo cua"])) {
    return locale === "vi" ? `Cửa hàng nhận đơn mỗi ngày từ ${formatStoreHours()}.` : `The store accepts orders daily from ${formatStoreHours()}.`;
  }

  return undefined;
}

function extractRequestedItems(text: string, session?: ConversationSession): RequestedItem[] {
  const segments = splitItemSegments(text);
  const requestedItems = new Map<string, RequestedItem>();

  for (const segment of segments) {
    const query = cleanItemQuery(segment);
    const item = resolveRequestedItem(segment, query, session);

    if (!item) {
      continue;
    }

    const quantity = extractQuantity(segment);
    const existingItem = requestedItems.get(item.sku);

    requestedItems.set(item.sku, {
      item,
      quantity: (existingItem?.quantity ?? 0) + quantity,
      isQuantityExplicit: existingItem?.isQuantityExplicit || hasExplicitQuantity(segment)
    });
  }

  return [...requestedItems.values()];
}

function formatUnresolvedSegments(text: string, session: ConversationSession): string | undefined {
  const unresolvedSegments = splitItemSegments(text)
    .map((segment) => ({ segment, query: cleanItemQuery(segment) }))
    .filter(({ segment, query }) => query && !resolveRequestedItem(segment, query, session));

  if (unresolvedSegments.length === 0) {
    return undefined;
  }

  return unresolvedSegments
    .map(({ query }) => {
      const suggestions = suggestMenuItemsForText(query, 4);

      if (suggestions.length === 0) {
        return session.locale === "vi" ? `Mình chưa tìm thấy "${query}" trong menu.` : `I could not find "${query}" in the menu.`;
      }

      return [
        session.locale === "vi" ? `Mình chưa chắc "${query}" là món nào. Bạn muốn chọn món nào dưới đây?` : `I could not identify "${query}" exactly. Which one did you mean?`,
        ...suggestions.map(formatMenuLine)
      ].join("\n");
    })
    .join("\n\n");
}

function resolveRequestedItem(segment: string, query: string, session?: ConversationSession): MenuItem | undefined {
  return getMenuItemByOrderId(extractOrderId(segment) ?? "") ?? findMenuItemByText(query) ?? findContextualDraftItem(session, query);
}

function hasExplicitQuantity(text: string): boolean {
  const normalizedText = normalizeSearchText(text);
  return /\b[1-9][0-9]?\b/.test(normalizedText) || /\b(?:mot|hai|ba|bon|tu|nam|sau|bay|tam|chin|muoi)\b/.test(normalizedText);
}

function findContextualDraftItem(session: ConversationSession | undefined, query: string): MenuItem | undefined {
  if (!session || !query) {
    return undefined;
  }

  const queryWords = normalizeSearchText(query).split(" ").filter(Boolean);
  const matches = session.draft.items
    .map((draftItem) => getMenuItem(draftItem.sku))
    .filter((item): item is MenuItem => Boolean(item))
    .filter((item) => {
      const searchableText = normalizeSearchText(`${item.name} ${item.aliases.join(" ")}`);
      return queryWords.every((word) => searchableText.includes(word));
    });

  return matches.length === 1 ? matches[0] : undefined;
}

function handleImageRequest(session: ConversationSession, text: string): ChatMessageResult {
  const requestedItems = extractRequestedItems(text, session);

  if (requestedItems.length === 1) {
    const item = requestedItems[0].item;
    return reply(session.locale === "vi" ? `Đây là hình của ${item.name}.` : `Here is an image of ${item.name}.`, [item.imageUrl]);
  }

    return reply(formatUnresolvedItemResponse(text, session.locale));
  }

function cleanItemQuery(text: string): string {
  return normalizeSearchText(text)
    .replace(/\b(?:cho|minh|toi|em|anh|chi|lay|dat|goi|them|add|muon|phan|cai|mon|bo|xoa|huy|doi|sua|thay|lai|xem|hinh|photo)\b/g, " ")
    .replace(/\b[0-9]+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractOrderId(text: string): string | undefined {
  const match = text.match(/\bM([0-9]{3,})\b/i);
  return match ? `M${match[1]}` : undefined;
}

function formatUnresolvedItemResponse(text: string, locale: ConversationSession["locale"] = "en"): string {
  const query = cleanItemQuery(text);
  const suggestions = query ? suggestMenuItemsForText(query, 3) : [];

  if (suggestions.length > 0) {
    return locale === "vi"
      ? [
          `Mình chưa chắc "${query}" là món nào.`,
          "Bạn muốn chọn một trong các món này không?",
          ...suggestions.map(formatMenuLine)
        ].join("\n")
      : [
          `I could not identify \"${query}\" exactly.`,
          "Did you mean one of these items?",
          ...suggestions.map(formatMenuLine)
        ].join("\n");
  }

  return locale === "vi"
    ? `Mình chưa tìm thấy "${query || text.trim()}" trong menu hiện tại. Bạn gõ /menu để xem món đang bán nhé.`
    : `I could not find \"${query || text.trim()}\" in the current menu. Type /menu to view available items.`;
}

function splitItemSegments(text: string): string[] {
  return text
    .replace(/\+/g, " and ")
    .split(/\s+(?:và|va|thêm|them|add|and)\s+|[,;]/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function extractQuantity(text: string): number {
  const normalizedText = normalizeSearchText(text);
  const digitMatch = normalizedText.match(/\b([1-9][0-9]?)\b/);

  if (digitMatch) {
    return clampQuantity(Number(digitMatch[1]));
  }

  const wordQuantities = new Map([
    ["mot", 1],
    ["moi", 1],
    ["hai", 2],
    ["ba", 3],
    ["bon", 4],
    ["tu", 4],
    ["nam", 5],
    ["sau", 6],
    ["bay", 7],
    ["tam", 8],
    ["chin", 9],
    ["muoi", 10]
  ]);

  for (const [word, quantity] of wordQuantities) {
    if (new RegExp(`\\b${word}\\b`).test(normalizedText)) {
      return quantity;
    }
  }

  return 1;
}

function extractContactInfo(text: string, session: ConversationSession): { phone?: string; address?: string } {
  const phoneMatch = text.match(/(?:\+84|0)[0-9 .-]{8,12}/);
  const phone = phoneMatch?.[0].replace(/[^\d+]/g, "");
  const addressMatch = text.match(/(?:^|\s)(?:địa chỉ|dia chi|giao tới|giao toi|deliver to|delivery address|address|ở|o)(?:\s*:\s*|\s+)(.+)$/i);
  let address = cleanAddress(addressMatch?.[1]);

  if (!address && phoneMatch) {
    const remainingText = text.replace(phoneMatch[0], "").replace(/(?:số điện thoại|so dien thoai|sdt|phone)/gi, "").trim();

    if (remainingText.length >= 8) {
      address = cleanAddress(remainingText);
    }
  }

  if (!address && !phoneMatch && session.pendingQuestion === "checkout" && !session.draft.customer.address) {
    address = inferStandaloneAddress(text);
  }

  return {
    phone,
    address
  };
}

function inferStandaloneAddress(text: string): string | undefined {
  const normalizedText = normalizeSearchText(text);

  if (!/^[0-9]+\s+[a-z]/.test(normalizedText)) {
    return undefined;
  }

  if (suggestMenuItemsForText(cleanItemQuery(text), 1).length > 0) {
    return undefined;
  }

  return cleanAddress(text);
}

function cleanAddress(value: string | undefined): string | undefined {
  const address = value
    ?.replace(/[,;]?\s*(?:thanh toán|thanh toan|payment)?\s*(?:cod|vnpay)\s*$/i, "")
    .trim();

  return address && address.length >= 5 ? address : undefined;
}

function extractPaymentMethod(normalizedText: string): PaymentMethod | undefined {
  if (containsAny(normalizedText, ["vnpay", "chuyen khoan", "thanh toan online", "online"])) {
    return "vnpay";
  }

  if (containsAny(normalizedText, ["cod", "tien mat", "tra khi nhan", "thanh toan khi nhan hang"])) {
    return "cod";
  }

  return undefined;
}

function extractCouponCode(text: string): string | undefined {
  const match = text.match(/(?:ma giam gia|mã giảm giá|coupon|promo)\s*:?\s*([a-z0-9_-]{3,32})/i);
  return match?.[1]?.toUpperCase();
}

function extractOrderNotes(text: string): string | undefined {
  const match = text.match(/(?:ghi chu|ghi chú|note)\s*:?\s*(.{2,200})$/i);
  return match?.[1]?.trim();
}

function getStockError(item: MenuItem, requestedQuantity: number): string | undefined {
  if (!item.isAvailable || item.stockQuantity <= 0) {
    const alternatives = suggestAlternatives(item);
    const suggestion = alternatives.length > 0 ? ` You could try: ${alternatives.map((candidate) => candidate.name).join(", ")}.` : "";

    return `${item.name} is currently unavailable.${suggestion}`;
  }

  if (requestedQuantity > item.stockQuantity) {
    return `Only ${item.stockQuantity} serving(s) of ${item.name} remain. Would you like to reduce the quantity?`;
  }

  return undefined;
}

function getMissingCustomerFields(customer: DraftCustomer): string[] {
  const missingFields: string[] = [];

  if (!customer.phone || !/^(0|\+84)[0-9]{8,10}$/.test(customer.phone)) {
    missingFields.push("a valid phone number");
  }

  if (!customer.address) {
    missingFields.push("a delivery address");
  }

  return missingFields;
}

function getMissingCheckoutFields(draft: DraftOrder): string[] {
  const missingFields = getMissingCustomerFields(draft.customer);

  if (!draft.paymentMethod) {
    missingFields.push("a payment method (COD/VNPay)");
  }

  return missingFields;
}

function isGreeting(normalizedText: string): boolean {
  return normalizedText === "start" || /^(?:xin chao|chao|hello|hi)(?:\s|$)/.test(normalizedText);
}

function isMenuIntent(normalizedText: string): boolean {
  return containsAny(normalizedText, ["menu", "thuc don", "xem mon", "co mon gi"]);
}

function isShowCartIntent(normalizedText: string): boolean {
  return containsAny(normalizedText, [
    "gio hang",
    "don nhap",
    "don hien tai",
    "don hang hien tai",
    "don hang cua toi",
    "don cua toi",
    "xem don",
    "cart"
  ]);
}

function isLoyaltyInquiryIntent(normalizedText: string): boolean {
  return containsAny(normalizedText, [
    "diem thanh vien",
    "diem tich luy",
    "diem loyalty",
    "loyalty point",
    "loyalty points",
    "member point",
    "member points",
    "points",
    "bao nhieu diem",
    "hang thanh vien"
  ]);
}

function isVoucherOptimizerIntent(normalizedText: string): boolean {
  return containsAny(normalizedText, [
    "ma nao giam nhieu nhat",
    "voucher nao tot nhat",
    "ma tot nhat",
    "chon ma",
    "tu ap ma",
    "ap ma tot nhat",
    "dung ma nao",
    "best voucher",
    "best coupon",
    "auto voucher",
    "voucher",
    "apply best"
  ]);
}

function isHumanHandoffIntent(normalizedText: string): boolean {
  return containsAny(normalizedText, [
    "gap nhan vien",
    "noi chuyen voi nhan vien",
    "nguoi that",
    "tu van vien",
    "call center",
    "staff",
    "human",
    "agent",
    "handoff"
  ]);
}

function isLegacyAddressIntent(normalizedText: string): boolean {
  return containsAny(normalizedText, ["dia chi cu", "giao nhu cu", "giao ve nha cu", "old address", "saved address"]);
}

function isRemoveIntent(normalizedText: string): boolean {
  return /(?:^|\s)bo\s+/.test(normalizedText) || containsAny(normalizedText, ["xoa mon", "huy mon", "khong lay", "remove"]);
}

function isChangeIntent(normalizedText: string): boolean {
  return /(?:^|\s)(?:doi|sua|thay|change|replace|update)\s+/.test(normalizedText);
}

function isConfirmIntent(normalizedText: string): boolean {
  return containsAny(normalizedText, ["xac nhan", "dong y", "chot don", "confirm", "ok chot", "dat hang"]);
}

function isSkipCouponIntent(normalizedText: string): boolean {
  return containsAny(normalizedText, ["khong co coupon", "khong co ma", "khong dung ma", "bo qua coupon", "no coupon"]);
}

function isBareNegativeIntent(normalizedText: string): boolean {
  return ["khong co", "ko co", "khong", "ko", "no", "nope", "none"].includes(normalizedText);
}

function isOrderRequestIntent(normalizedText: string): boolean {
  return /(?:^|\s)(?:cho|lay|dat|goi|them|add|muon|order|want|i want|give)\s+/.test(normalizedText) || /^(?:[1-9][0-9]?|mot|moi|hai|ba|bon|tu|nam|sau|bay|tam|chin|muoi)\s+/.test(normalizedText);
}

function isMenuCodeRequest(text: string): boolean {
  return /\bM[0-9]{3,}\b/i.test(text);
}

function isCancelDraftIntent(normalizedText: string): boolean {
  return containsAny(normalizedText, ["huy don", "bo don", "huy gio", "bo gio", "xoa gio", "cancel", "cancel order", "discard order"]);
}

function isImageIntent(normalizedText: string): boolean {
  return /(?:^|\s)(?:anh|hinh|photo|image|picture)(?:\s|$)/.test(normalizedText);
}

function containsAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function extractBudgetVnd(normalizedText: string): number | undefined {
  const underMatch = normalizedText.match(/\b(?:duoi|tam|khoang|around|under|below)?\s*([1-9][0-9]{1,3})\s*(?:k|nghin|ngan)\b/);

  if (underMatch) {
    return Number(underMatch[1]) * 1000;
  }

  const vndMatch = normalizedText.match(/\b([1-9][0-9]{4,7})\s*(?:vnd|dong)?\b/);

  if (vndMatch) {
    return Number(vndMatch[1]);
  }

  return undefined;
}

function extractDiners(normalizedText: string): number | undefined {
  const digitMatch = normalizedText.match(/\b([2-9]|10)\s*(?:nguoi|ng|pax|people)\b/);

  if (digitMatch) {
    return Number(digitMatch[1]);
  }

  const wordMatches = new Map([
    ["hai nguoi", 2],
    ["ba nguoi", 3],
    ["bon nguoi", 4],
    ["nam nguoi", 5]
  ]);

  for (const [phrase, diners] of wordMatches) {
    if (normalizedText.includes(phrase)) {
      return diners;
    }
  }

  return undefined;
}

function formatLegacyAddressUnavailable(session: ConversationSession): string {
  return session.locale === "vi"
    ? [
        "Mình chưa có address book đã xác thực cho cuộc trò chuyện này, nên không tự dùng \"địa chỉ cũ\" được.",
        "Bạn gửi lại địa chỉ giao hàng giúp mình nhé."
      ].join("\n")
    : [
        "I do not have a verified saved address for this conversation, so I cannot use an old address automatically.",
        "Please send the delivery address again."
      ].join("\n");
}

function isStoreOpen(now: Date): boolean {
  const hour = getStoreHour(now);
  const storeHours = getStoreHours();

  if (storeHours.openHour < storeHours.closeHour) {
    return hour >= storeHours.openHour && hour < storeHours.closeHour;
  }

  return hour >= storeHours.openHour || hour < storeHours.closeHour;
}

function getStoreHour(now: Date): number {
  const formattedHour = new Intl.DateTimeFormat("en-US", {
    timeZone: config.store.timezone,
    hour: "2-digit",
    hour12: false
  }).format(now);

  return Number(formattedHour) % 24;
}

function formatStoreHours(): string {
  const storeHours = getStoreHours();
  return `${String(storeHours.openHour).padStart(2, "0")}:00-${String(storeHours.closeHour).padStart(2, "0")}:00`;
}

function formatClosedStoreMessage(now: Date, locale: ConversationSession["locale"] = "en"): string {
  const storeHours = getStoreHours();
  const currentHour = getStoreHour(now);
  const nextOpening = currentHour >= storeHours.closeHour ? "tomorrow" : "today";

  return locale === "vi"
    ? `Hiện cửa hàng đang đóng. Bạn đặt lại ${nextOpening === "tomorrow" ? "vào ngày mai" : "hôm nay"} lúc ${String(storeHours.openHour).padStart(2, "0")}:00 nhé. Giờ mở cửa: ${formatStoreHours()}.`
    : `The store is currently closed. Please order again ${nextOpening} at ${String(storeHours.openHour).padStart(2, "0")}:00. Opening hours: ${formatStoreHours()}.`;
}

function formatMenuLine(item: MenuItem): string {
  const stockText = item.stockQuantity <= 5 ? `, ${item.stockQuantity} left` : "";
  const discountText = item.originalPrice && item.originalPrice > item.price ? ` (was ${formatVnd(item.originalPrice)})` : "";

  return `- [${item.orderId}] ${item.name}: ${formatVnd(item.price)}${discountText}${stockText}`;
}

function formatConfirmedOrder(order: Order, locale: ConversationSession["locale"] = "en"): string {
  const paymentLink = `${config.appBaseUrl.replace(/\/$/, "")}/payments/vnpay/orders/${order.id}`;

  if (locale === "vi") {
    return [
      order.status === "PENDING_PAYMENT" ? "Đơn của bạn đang chờ thanh toán VNPay." : "Mình đã xác nhận đơn của bạn.",
      `Mã đơn: ${order.id}`,
      ...order.quote.items.map((item) => `- ${item.quantity} x ${item.name}`),
      `Tổng cộng: ${formatVnd(order.quote.total)}`,
      `Thanh toán: ${formatPaymentMethod(order.paymentMethod)}.`,
      `Số điện thoại: ${order.customer.phone}.`,
      `Địa chỉ giao hàng: ${order.customer.address}.`,
      order.status === "PENDING_PAYMENT"
        ? `Bạn thanh toán VNPay tại đây: ${paymentLink}`
        : "Đơn đã xác nhận nên không hủy trực tiếp trong bot được."
    ].join("\n");
  }

  return [
    order.status === "PENDING_PAYMENT" ? "Your order is awaiting VNPay payment." : "Your order has been confirmed.",
    `Order ID: ${order.id}`,
    ...order.quote.items.map((item) => `- ${item.quantity} x ${item.name}`),
    `Total: ${formatVnd(order.quote.total)}`,
    `Payment: ${formatPaymentMethod(order.paymentMethod)}.`,
    `Phone: ${order.customer.phone}.`,
    `Delivery address: ${order.customer.address}.`,
    order.status === "PENDING_PAYMENT"
      ? `Pay with VNPay: ${paymentLink}`
      : "This order is confirmed and cannot be cancelled in this bot."
  ].join("\n");
}

function formatOrderError(error: unknown, locale: ConversationSession["locale"] = "en"): string {
  if (error instanceof AppError) {
    return locale === "vi" ? `Mình chưa xử lý được đơn: ${formatErrorMessage(error.message, locale)}` : `I could not process the order: ${error.message}`;
  }

  return locale === "vi" ? "Hiện mình chưa xử lý được đơn. Bạn thử lại giúp mình nhé." : "I cannot process the order right now. Please try again.";
}

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

function findBestVoucher(session: ConversationSession): { code: string; discount: number; total: number } | undefined {
  const candidates = coupons
    .map((coupon) => {
      try {
        const quote = createQuote({
          items: session.draft.items,
          couponCode: coupon.code,
          paymentMethod: session.draft.paymentMethod,
          deliveryAddress: session.draft.customer.address
        });

        if (!quote.coupon?.isApplied || quote.coupon.discount <= 0) {
          return undefined;
        }

        return {
          code: coupon.code,
          discount: quote.coupon.discount,
          total: quote.total
        };
      } catch {
        return undefined;
      }
    })
    .filter((candidate): candidate is { code: string; discount: number; total: number } => Boolean(candidate));

  return candidates.sort((left, right) => right.discount - left.discount || left.total - right.total)[0];
}

function createMockLoyaltyProfile(phone: string): { status: "verified"; phone: string; points: number; tier: string } {
  const digits = phone.replace(/\D/g, "");
  const seed = Number(digits.slice(-4) || "0");
  const points = 120 + (seed % 1800);
  const tier = points >= 1200 ? "Gold" : points >= 600 ? "Silver" : "Member";

  return {
    status: "verified",
    phone,
    points,
    tier
  };
}

function createHandoffSummary(session: ConversationSession, reason: string) {
  const missingFields = getMissingCheckoutFields(session.draft);
  const cart = session.draft.items
    .map((draftItem) => {
      const item = getMenuItem(draftItem.sku);
      return item ? `${draftItem.quantity} x ${item.name}` : `${draftItem.quantity} x ${draftItem.sku}`;
    })
    .join("; ");

  return {
    reason,
    status: session.status,
    cart: cart || "empty",
    coupon: session.draft.couponCode ?? "none",
    loyalty: session.draft.loyalty
      ? `${session.draft.loyalty.tier}, ${session.draft.loyalty.points} points`
      : "not verified",
    missingFields: missingFields.length > 0 ? formatMissingFields(missingFields, session.locale) : "none",
    nextAction: getHandoffNextAction(session, missingFields)
  };
}

function getHandoffNextAction(session: ConversationSession, missingFields: string[]): string {
  if (session.draft.items.length === 0) {
    return session.locale === "vi" ? "Hỏi khách muốn đặt món nào." : "Ask what the customer wants to order.";
  }

  if (missingFields.length > 0) {
    return session.locale === "vi"
      ? `Thu thập thêm ${formatMissingFields(missingFields, session.locale)}.`
      : `Collect ${formatMissingFields(missingFields, session.locale)}.`;
  }

  return session.locale === "vi"
    ? "Xác nhận lại đơn và hỗ trợ tạo đơn."
    : "Review the order and help create it.";
}

function formatLlmDraftSummary(session: ConversationSession): string {
  if (session.draft.items.length === 0) {
    return "empty";
  }

  const lines = session.draft.items.map((draftItem) => {
    const item = getMenuItem(draftItem.sku);
    return item ? `${draftItem.quantity} x ${item.name} [${item.orderId}]` : `${draftItem.quantity} x ${draftItem.sku}`;
  });

  return [
    ...lines,
    session.draft.couponCode ? `coupon: ${session.draft.couponCode}` : undefined,
    session.draft.paymentMethod ? `payment: ${formatPaymentMethod(session.draft.paymentMethod)}` : undefined,
    session.draft.customer.phone ? `phone: ${session.draft.customer.phone}` : undefined,
    session.draft.customer.address ? `address: ${session.draft.customer.address}` : undefined,
    session.draft.loyalty
      ? `loyalty: ${session.draft.loyalty.tier}, ${session.draft.loyalty.points} points`
      : undefined,
    session.draft.notes ? `notes: ${session.draft.notes}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

function formatLlmMenuContext(normalizedText: string): string {
  const directMatches = searchMenuItems(normalizedText, 12);
  const fallbackItems = directMatches.length > 0 ? directMatches : [...listHotCombos(6), ...listCheapestItems(6)];
  const uniqueItems = [...new Map(fallbackItems.map((item) => [item.sku, item])).values()].slice(0, 12);

  return uniqueItems
    .map((item) => {
      const stockText = item.isAvailable && item.stockQuantity > 0 ? `${item.stockQuantity} left` : "unavailable";
      return `[${item.orderId}] ${item.name} | ${formatVnd(item.price)} | ${item.categoryName} | ${stockText}`;
    })
    .join("\n");
}

function detectLocale(text: string, normalizedText: string, currentLocale: ConversationSession["locale"]): ConversationSession["locale"] {
  if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text)) {
    return "vi";
  }

  if (currentLocale === "vi" && isGreeting(normalizedText)) {
    return "vi";
  }

  const vietnameseSignals = [
    "cho minh",
    "cho em",
    "cho anh",
    "cho chi",
    "em muon",
    "anh muon",
    "chi muon",
    "ban oi",
    "alo",
    "toi muon",
    "minh muon",
    "dat mon",
    "goi mon",
    "them mon",
    "xem gio",
    "gio hang",
    "don hang",
    "xac nhan",
    "chot don",
    "khong co",
    "dia chi",
    "sdt",
    "so dien thoai",
    "thanh toan",
    "ghi chu",
    "huy don",
    "bo don",
    "doi",
    "sua"
  ];

  if (vietnameseSignals.some((signal) => normalizedText.includes(signal)) || hasVietnamesePronoun(normalizedText)) {
    return "vi";
  }

  const englishSignals = ["add", "remove", "change", "replace", "confirm", "delivery address", "phone", "no coupon"];

  if (englishSignals.some((signal) => normalizedText.includes(signal))) {
    return "en";
  }

  return currentLocale;
}

function hasVietnamesePronoun(normalizedText: string): boolean {
  return /\b(?:em|anh|chi|minh|toi|ban)\b/.test(normalizedText);
}

function getLanguageSwitchLocale(normalizedText: string): ConversationSession["locale"] | undefined {
  if (["tieng viet", "viet nam", "vietnamese", "vi", "vietnamese language"].includes(normalizedText)) {
    return "vi";
  }

  if (["english", "tieng anh", "en", "english language"].includes(normalizedText)) {
    return "en";
  }

  return undefined;
}

function getBudgetRecommendationResponse(normalizedText: string, locale: ConversationSession["locale"]): string | undefined {
  const budget = extractBudgetVnd(normalizedText);
  const diners = extractDiners(normalizedText);

  if (!budget && !diners) {
    return undefined;
  }

  const availableItems = listMenuItems().filter((item) => item.isAvailable && item.stockQuantity > 0);
  const candidates = availableItems
    .filter((item) => {
      const groupFit = diners && diners >= 2 ? item.categoryIds.includes("combo-nhom") || normalizeSearchText(item.name).includes("combo") : true;
      const budgetFit = budget ? item.price <= budget : true;
      return groupFit && budgetFit;
    })
    .sort((left, right) => {
      const leftDistance = budget ? Math.abs(budget - left.price) : 0;
      const rightDistance = budget ? Math.abs(budget - right.price) : 0;
      return leftDistance - rightDistance || right.price - left.price;
    })
    .slice(0, 5);

  if (candidates.length === 0) {
    return locale === "vi"
      ? "Mình chưa thấy combo nào khớp ngân sách đó. Bạn muốn mình gợi ý món giá thấp hơn không?"
      : "I could not find a combo that fits that budget. Would you like lower-priced options?";
  }

  return [
    locale === "vi"
      ? `Mình lọc vài lựa chọn${diners ? ` cho ${diners} người` : ""}${budget ? ` trong tầm ${formatVnd(budget)}` : ""}:`
      : `Here are options${diners ? ` for ${diners} people` : ""}${budget ? ` around ${formatVnd(budget)}` : ""}:`,
    ...candidates.map(formatMenuLine),
    locale === "vi"
      ? "Bạn chọn mã món và số lượng, mình sẽ thêm vào giỏ."
      : "Send the item ID and quantity to add one to your cart."
  ].join("\n");
}

function isLanguageHelpIntent(normalizedText: string): boolean {
  return ["language", "lang", "ngon ngu", "doi ngon ngu", "chuyen ngon ngu"].includes(normalizedText);
}

function formatLanguageSwitchConfirmation(locale: ConversationSession["locale"]): string {
  return locale === "vi"
    ? "Mình đã chuyển sang tiếng Việt. Bạn có thể dùng /en để đổi sang English, hoặc gõ /menu để xem thực đơn."
    : "I switched to English. Use /vi to switch to Vietnamese, or send /menu to view the menu.";
}

function formatLanguageHelp(locale: ConversationSession["locale"]): string {
  return locale === "vi"
    ? [
        "Bạn có thể đổi ngôn ngữ bằng slash command:",
        "/vi - Tiếng Việt",
        "/en - English"
      ].join("\n")
    : [
        "You can switch language with slash commands:",
        "/vi - Vietnamese",
        "/en - English"
      ].join("\n");
}

function formatEmptyCart(locale: ConversationSession["locale"]): string {
  return locale === "vi" ? "Giỏ hàng của bạn đang trống." : "Your cart is empty.";
}

function formatAddedLine(item: MenuItem, quantity: number, locale: ConversationSession["locale"]): string {
  return locale === "vi" ? `Mình đã thêm ${quantity} x ${item.name} vào giỏ.` : `Added ${quantity} x ${item.name}.`;
}

function formatRemovedLine(item: MenuItem, quantity: number | undefined, locale: ConversationSession["locale"]): string {
  if (quantity !== undefined) {
    return locale === "vi" ? `Mình đã bỏ ${quantity} x ${item.name}.` : `Removed ${quantity} x ${item.name}.`;
  }

  return locale === "vi" ? `Mình đã bỏ ${item.name} khỏi giỏ.` : `Removed ${item.name}.`;
}

function formatChangedItemLine(oldItem: MenuItem, newItem: MenuItem, locale: ConversationSession["locale"]): string {
  return locale === "vi" ? `Mình đã đổi ${oldItem.name} thành ${newItem.name}.` : `Changed ${oldItem.name} to ${newItem.name}.`;
}

function formatChangedQuantityLine(item: MenuItem, quantity: number, locale: ConversationSession["locale"]): string {
  return locale === "vi" ? `Mình đã đổi số lượng ${item.name} thành ${quantity}.` : `Changed the quantity of ${item.name} to ${quantity}.`;
}

function formatMissingFields(missingFields: string[], locale: ConversationSession["locale"]): string {
  if (locale !== "vi") {
    return missingFields.join(", ");
  }

  return missingFields.map(formatMissingField).join(", ");
}

function formatMissingField(field: string): string {
  const translations = new Map([
    ["a valid phone number", "số điện thoại hợp lệ"],
    ["a delivery address", "địa chỉ giao hàng"],
    ["a payment method (COD/VNPay)", "hình thức thanh toán (COD/VNPay)"]
  ]);

  return translations.get(field) ?? field;
}

function formatCouponReason(reason: string | undefined, locale: ConversationSession["locale"]): string | undefined {
  if (!reason || locale !== "vi") {
    return reason;
  }

  return formatErrorMessage(reason, locale);
}

function formatErrorMessage(message: string, locale: ConversationSession["locale"]): string {
  if (locale !== "vi") {
    return message;
  }

  if (message === "Coupon code does not exist.") {
    return "mã giảm giá không tồn tại.";
  }

  if (message === "Coupon has already been used.") {
    return "mã giảm giá này đã được sử dụng.";
  }

  if (message === "Coupon is inactive.") {
    return "mã giảm giá hiện không hoạt động.";
  }

  if (message === "Coupon has expired.") {
    return "mã giảm giá đã hết hạn.";
  }

  if (message.startsWith("Minimum subtotal is ")) {
    return message.replace("Minimum subtotal is ", "giá trị món tối thiểu là ");
  }

  if (message.startsWith("Coupon requires payment method: ")) {
    return message.replace("Coupon requires payment method: ", "mã này chỉ áp dụng cho phương thức thanh toán: ");
  }

  if (message.endsWith("is currently unavailable.")) {
    return message.replace(" is currently unavailable.", " hiện không khả dụng.");
  }

  if (message.includes("only has") && message.includes("item(s) left")) {
    return message.replace(" only has ", " chỉ còn ").replace(" item(s) left.", " phần.");
  }

  return message;
}

function getOrCreateSession(chatId: string, displayName: string): ConversationSession {
  const existingSession = sessions.get(chatId);

  if (existingSession) {
    return existingSession;
  }

  const session: ConversationSession = {
    chatId,
    locale: "en",
    status: "IDLE",
    draft: {
      items: [],
      customer: {
        name: displayName
      },
      couponHandled: false
    },
    updatedAt: new Date().toISOString()
  };

  sessions.set(chatId, session);
  return session;
}

function resetDraft(session: ConversationSession) {
  session.status = "IDLE";
  session.lastOrderId = undefined;
  session.draft.items = [];
  session.draft.couponCode = undefined;
  session.draft.couponHandled = false;
  session.draft.paymentMethod = undefined;
  session.draft.notes = undefined;
  session.draft.loyalty = undefined;
  session.pendingQuestion = undefined;
}

function reply(message: string, imageUrls: string[] = []): ChatMessageResult {
  return {
    reply: message,
    createdOrderIds: [],
    imageUrls
  };
}

function clampQuantity(quantity: number): number {
  return Math.min(Math.max(quantity, 1), 20);
}

function formatPaymentMethod(paymentMethod: PaymentMethod): string {
  return paymentMethod === "vnpay" ? "VNPay" : "COD";
}

function formatPaymentQuestion(locale: ConversationSession["locale"] = "en"): string {
  return locale === "vi"
    ? [
        "Bạn muốn thanh toán bằng hình thức nào?",
        "Nhắn \"COD\" để trả tiền khi nhận hàng, hoặc \"VNPay\" để thanh toán online."
      ].join("\n")
    : [
        "Which payment method would you prefer?",
        "Reply \"COD\" to pay on delivery or \"VNPay\" to pay online."
      ].join("\n");
}
