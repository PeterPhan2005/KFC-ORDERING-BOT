import { config } from "../config.js";
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
};

type ConversationSession = {
  chatId: string;
  status: ConversationStatus;
  draft: DraftOrder;
  lastOrderId?: string;
  pendingQuestion?: "checkout" | "coupon" | "payment";
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

type RequestedItem = {
  item: MenuItem;
  quantity: number;
  isQuantityExplicit: boolean;
};

const sessions = new Map<string, ConversationSession>();

export async function processChatMessage(input: ChatMessageInput): Promise<ChatMessageResult> {
  const text = input.text.trim();
  const normalizedText = normalizeSearchText(text);
  const session = getOrCreateSession(input.chatId, input.displayName);
  session.updatedAt = new Date().toISOString();

  if (!text) {
    return reply("I can only process text messages. Type /menu to view the menu.");
  }

  const contactUpdate = extractContactInfo(text, session);

  if (contactUpdate.phone) {
    session.draft.customer.phone = contactUpdate.phone;
  }

  if (contactUpdate.address) {
    session.draft.customer.address = contactUpdate.address;
  }

  if (isGreeting(normalizedText)) {
    return reply(
      [
        "Hello! I am the KFC ordering bot.",
        "Would you like to view the menu, get a combo suggestion, or place an order?",
        "Example: \"2 Zinger Burger Combos\", \"M001-2\", or \"/menu\"."
      ].join("\n")
    );
  }

  if (isCancelDraftIntent(normalizedText)) {
    return handleCancelDraft(session);
  }

  if (isConfirmIntent(normalizedText)) {
    return handleConfirmOrder(session, input.now ?? new Date());
  }

  if (isImageIntent(normalizedText)) {
    return handleImageRequest(session, text);
  }

  if (isMenuIntent(normalizedText)) {
    return reply(formatMenuResponse(text));
  }

  const couponCode = extractCouponCode(text);

  if (couponCode) {
    session.draft.couponCode = couponCode;
    session.draft.couponHandled = true;
    session.pendingQuestion = undefined;
    return reply(formatDraftResponse(session));
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
    return reply(formatPaymentQuestion());
  }

  const notes = extractOrderNotes(text);

  if (notes) {
    session.draft.notes = notes;
    return reply(["I added your note to the order.", formatDraftResponse(session)].join("\n\n"));
  }

  const recommendation = getRecommendationResponse(normalizedText);

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
    return reply(formatUnresolvedItemResponse(text));
  }

  if (contactUpdate.phone || contactUpdate.address) {
    return reply(formatDraftResponse(session));
  }

  if (session.pendingQuestion === "checkout") {
    return reply(
      [
        "I could not confidently identify the checkout details in that message.",
        `Please send the missing details: ${getMissingCheckoutFields(session.draft).join(", ")}.`,
        "Example: \"0900000000, 123 Nguyen Trai Street, District 1, COD\"."
      ].join("\n")
    );
  }

  return reply(
    [
      "I did not understand that.",
      "Type /menu, ask for \"cheapest items\" or \"hot combos\", or order with \"add 1 Pepsi\"."
    ].join("\n")
  );
}

export function clearConversationSessionsForTest() {
  sessions.clear();
}

function handleAddItems(session: ConversationSession, requestedItems: RequestedItem[], now: Date): ChatMessageResult {
  if (!isStoreOpen(now)) {
    return reply(formatClosedStoreMessage(now));
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

    lines.push(`Added ${requestedItem.quantity} x ${requestedItem.item.name}.`);
  }

  return reply([...lines, formatDraftResponse(session)].join("\n\n"));
}

function handleRemoveItems(session: ConversationSession, text: string): ChatMessageResult {
  if (session.draft.items.length === 0) {
    return reply("Your cart is empty.");
  }

  const requestedItems = extractRequestedItems(text, session);

  if (requestedItems.length === 0) {
    return reply("Which item would you like to remove? For example: \"remove Pepsi\" or \"remove Zinger Burger\".");
  }

  const removedLines: string[] = [];

  for (const requestedItem of requestedItems) {
    const existingIndex = session.draft.items.findIndex((item) => item.sku === requestedItem.item.sku);

    if (existingIndex === -1) {
      removedLines.push(`${requestedItem.item.name} is not in your cart.`);
      continue;
    }

    const existingItem = session.draft.items[existingIndex];

    if (requestedItem.isQuantityExplicit && requestedItem.quantity < existingItem.quantity) {
      existingItem.quantity -= requestedItem.quantity;
      removedLines.push(`Removed ${requestedItem.quantity} x ${requestedItem.item.name}.`);
    } else {
      session.draft.items.splice(existingIndex, 1);
      removedLines.push(`Removed ${requestedItem.item.name}.`);
    }
  }

  session.status = session.draft.items.length > 0 ? "BUILDING_ORDER" : "IDLE";
  return reply([...removedLines, formatDraftResponse(session)].join("\n\n"));
}

function handleChangeItems(session: ConversationSession, text: string): ChatMessageResult {
  if (session.draft.items.length === 0) {
    return reply("Your cart is empty. What would you like to order?");
  }

  const changeParts = text.split(/\s+(?:thành|thanh|sang|to|with)\s+/i);

  if (changeParts.length === 2) {
    const oldItems = extractRequestedItems(changeParts[0], session);
    const newItems = extractRequestedItems(changeParts[1], session);
    const oldItem = oldItems[0];

    if (!oldItem) {
      return reply("I could not identify the item you want to change.");
    }

    const existingItem = session.draft.items.find((item) => item.sku === oldItem.item.sku);

    if (!existingItem) {
      return reply(`${oldItem.item.name} is not in your cart.`);
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
      return reply([`Changed ${oldItem.item.name} to ${newItem.item.name}.`, formatDraftResponse(session)].join("\n\n"));
    }

    const quantity = extractQuantity(changeParts[1]);
    const stockError = getStockError(oldItem.item, quantity);

    if (stockError) {
      return reply(stockError);
    }

    existingItem.quantity = quantity;
    session.status = "BUILDING_ORDER";
    return reply([`Changed the quantity of ${oldItem.item.name} to ${quantity}.`, formatDraftResponse(session)].join("\n\n"));
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

    return reply([`Changed the quantity of ${requestedItem.item.name} to ${requestedItem.quantity}.`, formatDraftResponse(session)].join("\n\n"));
  }

  return reply("Which item would you like to change? For example: \"change Pepsi to 2\" or \"replace Pepsi with 7Up\".");
}

function handleCancelDraft(session: ConversationSession): ChatMessageResult {
  if (session.status === "CONFIRMED" && session.lastOrderId) {
    return reply(`Order ${session.lastOrderId} is confirmed and can no longer be cancelled in this bot.`);
  }

  if (session.draft.items.length === 0) {
    return reply("You do not have a draft order to cancel.");
  }

  resetDraft(session);
  return reply("Your current draft order has been cancelled. Type /menu to start a new order.");
}

async function handleConfirmOrder(session: ConversationSession, now: Date): Promise<ChatMessageResult> {
  if (session.status === "CONFIRMED" && session.lastOrderId) {
    return reply(`Order ${session.lastOrderId} is confirmed. I cannot change or cancel it in this bot.`);
  }

  if (session.draft.items.length === 0) {
    return reply("Your cart is empty. What would you like to order?");
  }

  if (!isStoreOpen(now)) {
    return reply(formatClosedStoreMessage(now));
  }

  const missingFields = getMissingCheckoutFields(session.draft);

  if (missingFields.length > 0) {
    session.pendingQuestion = "checkout";
    return reply(
      [
        "I need more information before I can confirm the order.",
        `Missing: ${missingFields.join(", ")}.`,
        "You can send all three details in one message, for example: \"0900000000, 123 Nguyen Trai Street, COD\"; or send them across multiple messages."
      ].join("\n")
    );
  }

  if (!session.draft.couponHandled) {
    session.pendingQuestion = "coupon";
    return reply(
      [
        "Do you have a coupon code?",
        "If you do, send it like this: \"coupon KFC20\".",
        "If you do not have one, reply \"no\"."
      ].join("\n")
    );
  }

  if (!session.draft.paymentMethod) {
    session.pendingQuestion = "payment";
    return reply(formatPaymentQuestion());
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
      reply: formatConfirmedOrder(order),
      createdOrderIds: [order.id],
      imageUrls: []
    };
  } catch (error) {
    return reply(formatOrderError(error));
  }
}

function formatDraftResponse(session: ConversationSession): string {
  if (session.draft.items.length === 0) {
    return "Your cart is empty.";
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
      "Your draft order:",
      ...quote.items.map((item) => `- ${item.quantity} x ${item.name}: ${formatVnd(item.lineTotal)}`),
      `Subtotal: ${formatVnd(quote.subtotal)}`,
      quote.coupon
        ? quote.coupon.isApplied
          ? `Coupon ${quote.coupon.code}: saved ${formatVnd(quote.coupon.discount)}.`
          : `Coupon ${quote.coupon.code} was not applied: ${quote.coupon.reason}`
        : undefined,
      `Delivery fee: ${formatVnd(quote.deliveryFee)}`,
      `Estimated total: ${formatVnd(quote.total)}`,
      `Payment: ${session.draft.paymentMethod ? formatPaymentMethod(session.draft.paymentMethod) : "Not selected (COD/VNPay)"}.`,
      session.draft.customer.phone ? `Phone: ${session.draft.customer.phone}.` : undefined,
      session.draft.customer.address ? `Delivery address: ${session.draft.customer.address}.` : undefined,
      session.draft.notes ? `Note: ${session.draft.notes}.` : undefined,
      missingFields.length > 0
        ? `Still needed: ${missingFields.join(", ")}.`
        : "If everything is correct, reply \"confirm\". Confirmed orders cannot be cancelled in this bot."
    ].filter(Boolean).join("\n");
  } catch (error) {
    return formatOrderError(error);
  }
}

function formatMenuResponse(text: string): string {
  const normalizedText = normalizeSearchText(text);
  const searchQuery = normalizedText.replace(/\b(menu|thuc don|xem|co gi|mon|show|view|what|items)\b/g, "").trim();

  if (searchQuery.length >= 3) {
    const matches = searchMenuItems(searchQuery, 8);

    if (matches.length > 0) {
      return ["I found these items:", ...matches.map(formatMenuLine), "Which item would you like to add?"].join("\n");
    }
  }

  const categories = [...new Set(listMenuItems().map((item) => item.categoryName))].slice(0, 8);
  const featuredItems = listHotCombos(5);

  return [
    "KFC menu categories:",
    ...categories.map((category) => `- ${category}`),
    "",
    "Featured items:",
    ...featuredItems.map(formatMenuLine),
    "Ask for \"cheapest items\" or \"hot combos\", or order with \"2 Zinger Burger Combos\"."
  ].join("\n");
}

function getRecommendationResponse(normalizedText: string): string | undefined {
  if (containsAny(normalizedText, ["het mon", "mon nao het", "sold out", "unavailable", "out of stock"])) {
    const unavailableItems = listUnavailableItems(8);

    if (unavailableItems.length === 0) {
      return "No items are currently unavailable. Would you like to view the menu or place an order?";
    }

    return ["Unavailable items:", ...unavailableItems.map(formatMenuLine)].join("\n");
  }

  if (containsAny(normalizedText, ["spicy", "hot food", "something hot", "something spicy", "smth spicy", "cay", "do cay"])) {
    const spicyItems = listMenuItems()
      .filter((item) => item.isAvailable && item.stockQuantity > 0)
      .filter((item) => /pepper lime|garlic fish sauce|zinger|chicken yo/i.test(item.name))
      .slice(0, 6);

    return ["Spicy recommendations:", ...spicyItems.map(formatMenuLine), "Tell me an item ID and quantity to add it."].join("\n");
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
    return ["Current cheapest items:", ...listCheapestItems(6).map(formatMenuLine)].join("\n");
  }

  if (containsAny(normalizedText, ["which price", "better price", "best value", "value for money", "best deal"])) {
    return [
      "For the best value, these current deals are worth considering:",
      ...listHotCombos(6).map(formatMenuLine),
      "You can also ask for \"lowest price items\" to see the cheapest options."
    ].join("\n");
  }

  if (containsAny(normalizedText, ["5 10", "5 den 10", "nhom", "nhieu nguoi", "10 nguoi", "combo nhom", "group combo", "for a group", "large group"])) {
    return ["Group combos for larger parties:", ...listGroupCombos(5).map(formatMenuLine)].join("\n");
  }

  if (containsAny(normalizedText, ["combo hot", "hot", "uu dai", "deal", "goi y", "recommend", "suggestion"])) {
    return ["Recommended combos and deals:", ...listHotCombos(6).map(formatMenuLine)].join("\n");
  }

  if (containsAny(normalizedText, ["gio mo cua", "may gio", "dong cua", "mo cua"])) {
    return `The store accepts orders daily from ${formatStoreHours()}.`;
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
        return `I could not find "${query}" in the menu.`;
      }

      return [
        `I could not identify "${query}" exactly. Which one did you mean?`,
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
    return reply(`Here is an image of ${item.name}.`, [item.imageUrl]);
  }

  return reply(formatUnresolvedItemResponse(text));
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

function formatUnresolvedItemResponse(text: string): string {
  const query = cleanItemQuery(text);
  const suggestions = query ? suggestMenuItemsForText(query, 3) : [];

  if (suggestions.length > 0) {
    return [
      `I could not identify \"${query}\" exactly.`,
      "Did you mean one of these items?",
      ...suggestions.map(formatMenuLine)
    ].join("\n");
  }

  return `I could not find \"${query || text.trim()}\" in the current menu. Type /menu to view available items.`;
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

function formatClosedStoreMessage(now: Date): string {
  const storeHours = getStoreHours();
  const currentHour = getStoreHour(now);
  const nextOpening = currentHour >= storeHours.closeHour ? "tomorrow" : "today";

  return `The store is currently closed. Please order again ${nextOpening} at ${String(storeHours.openHour).padStart(2, "0")}:00. Opening hours: ${formatStoreHours()}.`;
}

function formatMenuLine(item: MenuItem): string {
  const stockText = item.stockQuantity <= 5 ? `, ${item.stockQuantity} left` : "";
  const discountText = item.originalPrice && item.originalPrice > item.price ? ` (was ${formatVnd(item.originalPrice)})` : "";

  return `- [${item.orderId}] ${item.name}: ${formatVnd(item.price)}${discountText}${stockText}`;
}

function formatConfirmedOrder(order: Order): string {
  const paymentLink = `${config.appBaseUrl.replace(/\/$/, "")}/payments/vnpay/orders/${order.id}`;

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

function formatOrderError(error: unknown): string {
  if (error instanceof AppError) {
    return `I could not process the order: ${error.message}`;
  }

  return "I cannot process the order right now. Please try again.";
}

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

function getOrCreateSession(chatId: string, displayName: string): ConversationSession {
  const existingSession = sessions.get(chatId);

  if (existingSession) {
    return existingSession;
  }

  const session: ConversationSession = {
    chatId,
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

function formatPaymentQuestion(): string {
  return [
    "Which payment method would you prefer?",
    "Reply \"COD\" to pay on delivery or \"VNPay\" to pay online."
  ].join("\n");
}
