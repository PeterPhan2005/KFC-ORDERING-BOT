import { config } from "../config.js";

export type LlmLocale = "vi" | "en";

export type LlmChatContext = {
  locale: LlmLocale;
  userText: string;
  draftSummary: string;
  menuContext: string;
  missingFields: string[];
  pendingQuestion?: "checkout" | "coupon" | "payment" | "loyalty";
};

export type LlmInterpretation =
  | {
      action: "rewrite";
      text: string;
      confidence: number;
    }
  | {
      action: "reply";
      reply: string;
      confidence: number;
    }
  | {
      action: "none";
      confidence: number;
    };

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

export function isLlmConfigured(): boolean {
  return config.nodeEnv !== "test" && Boolean(config.llm.apiKey && config.llm.apiKey !== "replace-me");
}

export async function interpretChatMessageWithLlm(context: LlmChatContext): Promise<LlmInterpretation | undefined> {
  if (!isLlmConfigured()) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llm.timeoutMs);

  try {
    const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.llm.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages: [
          {
            role: "system",
            content: createRouterInstructions(context.locale)
          },
          {
            role: "user",
            content: createRouterInput(context)
          }
        ],
        temperature: 0.1,
        max_tokens: 240
      })
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn(`LLM routing failed with ${response.status} from ${config.llm.provider}: ${body.slice(0, 400)}`);
      return undefined;
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    return parseLlmInterpretation(extractChatCompletionText(payload));
  } catch (error) {
    console.warn("LLM routing failed.", error);
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function createRouterInstructions(locale: LlmLocale): string {
  const replyLanguage = locale === "vi" ? "Vietnamese" : "English";

  return [
    "You are an intent router for a KFC ordering bot, not the final order system.",
    `Use ${replyLanguage} for any customer-facing reply.`,
    "Return one valid JSON object only. Do not wrap it in markdown.",
    'The JSON shape is {"action":"rewrite"|"reply"|"none","text":"...","reply":"...","confidence":0.0}.',
    'Set unused string fields to "".',
    "Prefer action rewrite when the customer wants to order, edit the cart, provide checkout details, ask for menu, choose coupon/payment, confirm, cancel, check loyalty points, optimize vouchers, or request human handoff.",
    "The rewrite must be a short command that the deterministic bot can understand, such as:",
    "\"/menu\", \"2 combo burger zinger\", \"remove Pepsi\", \"change Pepsi to 2\", \"coupon KFC20\", \"dùng mã tốt nhất\", \"kiểm tra điểm thành viên\", \"gặp nhân viên\", \"no coupon\", \"COD\", \"VNPay\", \"sđt <customer phone> địa chỉ <customer address>\", \"ghi chú ít cay\", \"xác nhận\", \"hủy đơn\".",
    "If the customer asks you to choose, recommend, suggest, or pick food for them, use action reply with 2-4 concrete menu options from Relevant menu context. Include item IDs and ask which one they want to add.",
    "Do not rewrite to cart/current order unless the customer explicitly asks to view their current cart/order.",
    "Do not rewrite to /menu when the customer asks for a specific recommendation and Relevant menu context contains suitable options.",
    "Never invent prices, stock, order IDs, payment links, or final order confirmation.",
    "Never invent voucher validity, loyalty points, or member tier. Rewrite to the deterministic loyalty/voucher command instead.",
    "Never claim an order was created. Only the deterministic system may create orders.",
    "Use action reply only for small clarifying answers, off-topic messages, or if the request cannot be mapped safely.",
    "Use action none when the existing parser should handle it or when you are not confident.",
    "If a food item is ambiguous, rewrite to a menu/search request or ask a brief clarification instead of choosing a random item."
  ].join("\n");
}

function createRouterInput(context: LlmChatContext): string {
  return [
    `Customer message: ${context.userText}`,
    `Current locale: ${context.locale}`,
    `Pending question: ${context.pendingQuestion ?? "none"}`,
    `Missing checkout fields: ${context.missingFields.join(", ") || "none"}`,
    "",
    "Current draft:",
    context.draftSummary || "empty",
    "",
    "Relevant menu context:",
    context.menuContext || "No menu candidates."
  ].join("\n");
}

function extractChatCompletionText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("").trim();
  }

  return "";
}

function parseLlmInterpretation(value: string): LlmInterpretation | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const jsonText = extractJsonObject(value);
    const parsed = JSON.parse(jsonText) as Partial<LlmInterpretation> & {
      text?: string;
      reply?: string;
      confidence?: number;
    };
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;

    if (parsed.action === "rewrite" && typeof parsed.text === "string" && parsed.text.trim() && confidence >= 0.45) {
      return {
        action: "rewrite",
        text: parsed.text.trim(),
        confidence
      };
    }

    if (parsed.action === "reply" && typeof parsed.reply === "string" && parsed.reply.trim() && confidence >= 0.45) {
      return {
        action: "reply",
        reply: parsed.reply.trim(),
        confidence
      };
    }

    return {
      action: "none",
      confidence
    };
  } catch {
    return undefined;
  }
}

function extractJsonObject(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}
