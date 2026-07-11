import { config } from "../config.js";
import { AppError } from "../lib/app-error.js";
import { isDatabaseEnabled, queryDatabase } from "../lib/database.js";
import { publishAdminEvent } from "./admin-events.js";

export type StoreHours = {
  timezone: string;
  openHour: number;
  closeHour: number;
};

type StoreSettingRow = {
  key: string;
  value: string;
};

const STORE_SETTING_KEYS = ["timezone", "open_hour", "close_hour"];

export async function initializeStoreHours(): Promise<void> {
  if (!isDatabaseEnabled()) {
    return;
  }

  await queryDatabase(
    `INSERT INTO store_settings (key, value)
     VALUES ($1, $2), ($3, $4), ($5, $6)
     ON CONFLICT (key) DO NOTHING`,
    [
      "timezone",
      config.store.timezone,
      "open_hour",
      String(config.store.openHour),
      "close_hour",
      String(config.store.closeHour)
    ]
  );

  const result = await queryDatabase<StoreSettingRow>(
    "SELECT key, value FROM store_settings WHERE key = ANY($1::text[])",
    [STORE_SETTING_KEYS]
  );
  const values = new Map(result.rows.map((row) => [row.key, row.value]));
  const persistedHours = validateStoreHours({
    openHour: Number(values.get("open_hour") ?? config.store.openHour),
    closeHour: Number(values.get("close_hour") ?? config.store.closeHour)
  });

  config.store.timezone = values.get("timezone") ?? config.store.timezone;
  config.store.openHour = persistedHours.openHour;
  config.store.closeHour = persistedHours.closeHour;
}

export function getStoreHours(): StoreHours {
  return { ...config.store };
}

export async function updateStoreHours(input: Pick<StoreHours, "openHour" | "closeHour">): Promise<StoreHours> {
  const hours = validateStoreHours(input);

  if (isDatabaseEnabled()) {
    await queryDatabase(
      `INSERT INTO store_settings (key, value, updated_at)
       VALUES ($1, $2, NOW()), ($3, $4, NOW())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = EXCLUDED.updated_at`,
      ["open_hour", String(hours.openHour), "close_hour", String(hours.closeHour)]
    );
  }

  config.store.openHour = hours.openHour;
  config.store.closeHour = hours.closeHour;
  publishAdminEvent("store_hours_updated");

  return getStoreHours();
}

function validateStoreHours(input: Pick<StoreHours, "openHour" | "closeHour">): Pick<StoreHours, "openHour" | "closeHour"> {
  if (!Number.isInteger(input.openHour) || !Number.isInteger(input.closeHour)) {
    throw new AppError(400, "Store hours must be whole hours.");
  }

  if (input.openHour < 0 || input.openHour > 23) {
    throw new AppError(400, "Opening hour must be between 0 and 23.");
  }

  if (input.closeHour < 0 || input.closeHour > 24) {
    throw new AppError(400, "Closing hour must be between 0 and 24.");
  }

  if (input.openHour === input.closeHour) {
    throw new AppError(400, "Opening and closing hours must be different.");
  }

  return {
    openHour: input.openHour,
    closeHour: input.closeHour
  };
}
