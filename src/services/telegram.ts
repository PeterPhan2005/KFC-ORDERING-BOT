import { config } from "../config.js";
import { processChatMessage } from "./chatbot.js";

type TelegramChatId = number | string;

type TelegramMessage = {
  message_id?: number;
  text?: string;
  chat: {
    id: TelegramChatId;
    type?: string;
  };
  from?: {
    id?: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
};

export type TelegramProcessingResult = {
  processedEvents: number;
  createdOrders: string[];
};

const processedUpdateIds: number[] = [];
const processedUpdateIdSet = new Set<number>();
const telegramCommands = [
  { command: "start", description: "Start the bot" },
  { command: "menu", description: "View menu" },
  { command: "language", description: "Show language commands" },
  { command: "vi", description: "Switch to Vietnamese" },
  { command: "en", description: "Switch to English" },
  { command: "points", description: "Check loyalty points" },
  { command: "voucher", description: "Apply best voucher" },
  { command: "handoff", description: "Talk to staff" }
];

export function isTelegramWebhookAuthorized(secretHeader: string | undefined): boolean {
  if (!isConfiguredSecret(config.telegram.webhookSecret)) {
    return true;
  }

  return secretHeader === config.telegram.webhookSecret;
}

export async function configureTelegramBotCommands(): Promise<void> {
  if (config.nodeEnv === "test" || !isConfiguredSecret(config.telegram.botToken)) {
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/setMyCommands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      commands: telegramCommands
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Telegram setMyCommands failed with ${response.status}: ${body}`);
  }
}

export async function processTelegramWebhook(update: TelegramUpdate): Promise<TelegramProcessingResult> {
  if (update.update_id !== undefined && isDuplicateUpdate(update.update_id)) {
    return {
      processedEvents: 0,
      createdOrders: []
    };
  }

  const message = update.message;

  if (!message?.chat?.id) {
    return {
      processedEvents: 0,
      createdOrders: []
    };
  }

  const text = message.text?.trim().toLowerCase();

  if (!text) {
    await sendTelegramMessage(message.chat.id, "Hiện tại mình chỉ nhận đơn qua tin nhắn chữ. Bạn gõ /menu để xem món nhé.");
    return {
      processedEvents: 1,
      createdOrders: []
    };
  }

  const chatResult = await processChatMessage({
    chatId: String(message.chat.id),
    displayName: getTelegramDisplayName(message),
    text
  });

  await sendTelegramMessage(message.chat.id, chatResult.reply);
  await Promise.all(chatResult.imageUrls.map((imageUrl) => sendTelegramPhoto(message.chat.id, imageUrl)));

  return {
    processedEvents: 1,
    createdOrders: chatResult.createdOrderIds
  };
}

async function sendTelegramMessage(chatId: TelegramChatId, text: string): Promise<void> {
  if (config.nodeEnv === "test") {
    return;
  }

  if (!isConfiguredSecret(config.telegram.botToken)) {
    console.warn("TELEGRAM_BOT_TOKEN is not configured; skipping Telegram reply.");
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        remove_keyboard: true
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Telegram sendMessage failed with ${response.status}: ${body}`);
  }
}

async function sendTelegramPhoto(chatId: TelegramChatId, imageUrl: string): Promise<void> {
  if (config.nodeEnv === "test") {
    return;
  }

  if (!isConfiguredSecret(config.telegram.botToken)) {
    return;
  }

  const publicImageUrl = new URL(imageUrl, ensureTrailingSlash(config.appBaseUrl)).toString();
  const response = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendPhoto`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      photo: publicImageUrl
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Telegram sendPhoto failed with ${response.status}: ${body}`);
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function getTelegramDisplayName(message: TelegramMessage): string {
  return (
    message.from?.username ??
    [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") ??
    `Telegram ${message.chat.id}`
  );
}

function isConfiguredSecret(value: string): boolean {
  return Boolean(value && value !== "replace-me");
}

function isDuplicateUpdate(updateId: number): boolean {
  if (processedUpdateIdSet.has(updateId)) {
    return true;
  }

  processedUpdateIds.push(updateId);
  processedUpdateIdSet.add(updateId);

  if (processedUpdateIds.length > 500) {
    const removedUpdateId = processedUpdateIds.shift();

    if (removedUpdateId !== undefined) {
      processedUpdateIdSet.delete(removedUpdateId);
    }
  }

  return false;
}
