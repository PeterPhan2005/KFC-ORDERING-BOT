import "dotenv/config";

const required = ["APP_BASE_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_E2E_CHAT_ID"];
const missing = required.filter((name) => !process.env[name] || process.env[name] === "replace-me");

if (missing.length > 0) {
  throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

const appBaseUrl = process.env.APP_BASE_URL.replace(/\/$/, "");
const updateId = Date.now();
const response = await fetch(`${appBaseUrl}/webhooks/telegram`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Telegram-Bot-Api-Secret-Token": process.env.TELEGRAM_WEBHOOK_SECRET
  },
  body: JSON.stringify({
    update_id: updateId,
    message: {
      message_id: updateId,
      text: "/menu",
      chat: { id: Number(process.env.TELEGRAM_E2E_CHAT_ID), type: "private" },
      from: { id: Number(process.env.TELEGRAM_E2E_CHAT_ID), first_name: "E2E" }
    }
  })
});

const body = await response.text();

if (!response.ok) {
  throw new Error(`E2E webhook failed (${response.status}): ${body}`);
}

console.log("E2E webhook succeeded. Check Telegram for the menu reply.");
console.log(body);
