import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import type { Order } from "../types.js";
import { createOrder } from "./orders.js";

type MessengerSender = {
  id: string;
};

type MessengerMessage = {
  mid?: string;
  text?: string;
  is_echo?: boolean;
};

type MessengerEvent = {
  sender?: MessengerSender;
  message?: MessengerMessage;
  postback?: {
    title?: string;
    payload?: string;
  };
};

export type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: MessengerEvent[];
  }>;
};

export type MessengerProcessingResult = {
  processedEvents: number;
  createdOrders: string[];
};

export async function processMessengerWebhook(payload: MetaWebhookPayload): Promise<MessengerProcessingResult> {
  const createdOrders: string[] = [];
  let processedEvents = 0;

  if (payload.object !== "page") {
    return { processedEvents, createdOrders };
  }

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (!event.sender?.id || event.message?.is_echo) {
        continue;
      }

      processedEvents += 1;

      const text = event.message?.text?.trim().toLowerCase();

      if (text === "a") {
        const order = createSmokeTestOrder(event.sender.id);
        createdOrders.push(order.id);
        await sendMessengerText(event.sender.id, formatSmokeTestReply(order));
        continue;
      }

      if (text) {
        await sendMessengerText(
          event.sender.id,
          "Smoke test san sang. Hay nhan 'a' de tao mot don KFC fake tren server."
        );
      }
    }
  }

  return { processedEvents, createdOrders };
}

export function verifyMetaSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
  if (!isConfiguredSecret(config.meta.appSecret)) {
    return true;
  }

  if (!rawBody || !signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const receivedSignature = signatureHeader.slice("sha256=".length);
  const expectedSignature = createHmac("sha256", config.meta.appSecret).update(rawBody).digest("hex");

  const received = Buffer.from(receivedSignature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");

  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(received, expected);
}

async function sendMessengerText(recipientId: string, text: string): Promise<void> {
  if (config.nodeEnv === "test") {
    return;
  }

  if (!isConfiguredSecret(config.meta.pageAccessToken)) {
    console.warn("META_PAGE_ACCESS_TOKEN is not configured; skipping Messenger reply.");
    return;
  }

  const url = new URL(`https://graph.facebook.com/${config.meta.graphApiVersion}/me/messages`);
  url.searchParams.set("access_token", config.meta.pageAccessToken);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Messenger Send API failed with ${response.status}: ${body}`);
  }
}

function createSmokeTestOrder(senderId: string): Order {
  return createOrder({
    items: [
      { sku: "FRIED_CHICKEN_2PC", quantity: 1 },
      { sku: "PEPSI_REGULAR", quantity: 1 }
    ],
    paymentMethod: "cod",
    customer: {
      name: `Messenger ${senderId.slice(-6)}`,
      phone: "0900000000",
      address: "Smoke test address from Messenger"
    },
    notes: `Messenger smoke test order for sender ${senderId}`
  });
}

function formatSmokeTestReply(order: Order): string {
  return [
    "Da tao don KFC fake thanh cong.",
    `Ma don: ${order.id}`,
    `Trang thai: ${order.status}`,
    `Tong tien: ${formatVnd(order.quote.total)}`
  ].join("\n");
}

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

function isConfiguredSecret(value: string): boolean {
  return Boolean(value && value !== "replace-me");
}
