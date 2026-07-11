import { config } from "../config.js";
import { AppError } from "../lib/app-error.js";
import { publishAdminEvent } from "./admin-events.js";

export type StoreHours = {
  timezone: string;
  openHour: number;
  closeHour: number;
};

export function getStoreHours(): StoreHours {
  return { ...config.store };
}

export function updateStoreHours(input: Pick<StoreHours, "openHour" | "closeHour">): StoreHours {
  if (!Number.isInteger(input.openHour) || !Number.isInteger(input.closeHour)) {
    throw new AppError(400, "Store hours must be whole hours.");
  }

  if (input.openHour < 0 || input.openHour > 23 || input.closeHour < 0 || input.closeHour > 23) {
    throw new AppError(400, "Store hours must be between 0 and 23.");
  }

  if (input.openHour === input.closeHour) {
    throw new AppError(400, "Opening and closing hours must be different.");
  }

  config.store.openHour = input.openHour;
  config.store.closeHour = input.closeHour;
  publishAdminEvent("store_hours_updated");

  return getStoreHours();
}
