import { menuByOrderId, menuBySku, menuItems } from "../data/menu.js";
import { AppError } from "../lib/app-error.js";
import type { MenuItem, QuoteInputItem } from "../types.js";
import { publishAdminEvent } from "./admin-events.js";

export type UpdateMenuItemInput = {
  price?: number;
  stockQuantity?: number;
  isAvailable?: boolean;
};

const initialMenuItems = menuItems.map((item) => ({ ...item, aliases: [...item.aliases] }));

export function listMenuItems(): MenuItem[] {
  return menuItems;
}

export function listAvailableMenuItems(): MenuItem[] {
  return menuItems.filter((item) => item.isAvailable && item.stockQuantity > 0);
}

export function getMenuItem(sku: string): MenuItem | undefined {
  return menuBySku.get(sku);
}

export function getMenuItemByOrderId(orderId: string): MenuItem | undefined {
  return menuByOrderId.get(orderId.toUpperCase());
}

export function searchMenuItems(query: string, limit = 6): MenuItem[] {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return [];
  }

  return menuItems
    .map((item) => ({
      item,
      score: scoreMenuItem(item, normalizedQuery)
    }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.item.price - right.item.price)
    .slice(0, limit)
    .map((result) => result.item);
}

export function findMenuItemByText(text: string): MenuItem | undefined {
  const normalizedQuery = normalizeSearchText(text);
  const defaultVariant = findDefaultVariant(normalizedQuery);

  if (defaultVariant) {
    return defaultVariant;
  }

  const exactMatch = menuItems.find((item) => {
    return normalizeSearchText(item.name) === normalizedQuery || item.aliases.some((alias) => normalizeSearchText(alias) === normalizedQuery);
  });

  if (exactMatch) {
    return exactMatch;
  }

  const rankedMatches = menuItems
    .map((item) => ({ item, score: scoreMenuItem(item, normalizedQuery) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.item.price - right.item.price);
  const bestMatch = rankedMatches[0];
  const secondBestMatch = rankedMatches[1];

  if (!bestMatch || bestMatch.score < 40) {
    return undefined;
  }

  if (secondBestMatch && bestMatch.score - secondBestMatch.score < 12) {
    return undefined;
  }

  return bestMatch.item;
}

export function suggestMenuItemsForText(text: string, limit = 3): MenuItem[] {
  const normalizedQuery = normalizeSearchText(text);

  if (!normalizedQuery) {
    return [];
  }

  const minimumScore = normalizedQuery.split(" ").length === 1 ? 20 : 40;
  const queryWords = normalizedQuery.split(" ").filter(Boolean);
  const rankedItems = menuItems
    .map((item) => ({ item, score: scoreMenuItem(item, normalizedQuery) }))
    .filter((result) => result.score >= minimumScore)
    .sort((left, right) => right.score - left.score || left.item.price - right.item.price);
  const directNameMatches = rankedItems.filter(({ item }) => {
    const normalizedName = normalizeSearchText(item.name);
    return queryWords.every((word) => normalizedName.includes(word));
  });

  return (directNameMatches.length > 0 ? directNameMatches : rankedItems)
    .slice(0, limit)
    .map((result) => result.item);
}

export function listCheapestItems(limit = 5): MenuItem[] {
  return [...listAvailableMenuItems()]
    .sort((left, right) => left.price - right.price || left.name.localeCompare(right.name))
    .slice(0, limit);
}

export function listHotCombos(limit = 5): MenuItem[] {
  return [...listAvailableMenuItems()]
    .filter((item) => item.categoryIds.includes("uu-dai") || normalizeSearchText(item.name).includes("combo"))
    .sort((left, right) => {
      const leftDiscount = (left.originalPrice ?? left.price) - left.price;
      const rightDiscount = (right.originalPrice ?? right.price) - right.price;

      return rightDiscount - leftDiscount || right.price - left.price;
    })
    .slice(0, limit);
}

export function listGroupCombos(limit = 5): MenuItem[] {
  return [...listAvailableMenuItems()]
    .filter((item) => item.categoryIds.includes("combo-nhom"))
    .sort((left, right) => right.price - left.price)
    .slice(0, limit);
}

export function listUnavailableItems(limit = 8): MenuItem[] {
  return menuItems.filter((item) => !item.isAvailable || item.stockQuantity <= 0).slice(0, limit);
}

export function suggestAlternatives(item: MenuItem, limit = 3): MenuItem[] {
  return listAvailableMenuItems()
    .filter((candidate) => candidate.sku !== item.sku && candidate.category === item.category)
    .sort((left, right) => Math.abs(left.price - item.price) - Math.abs(right.price - item.price))
    .slice(0, limit);
}

export function getDefaultOrderItems(): QuoteInputItem[] {
  const preferredSkus = [
    "offline-combo-1-nguoi-combo-burger-zinger-10",
    "offline-thuc-uong-trang-mieng-pepsi-tieu-chuan-3"
  ];
  const preferredItems = preferredSkus
    .map((sku) => menuBySku.get(sku))
    .filter((item): item is MenuItem => Boolean(item?.isAvailable && item.stockQuantity > 0));

  if (preferredItems.length >= 2) {
    return preferredItems.map((item) => ({
      sku: item.sku,
      quantity: 1
    }));
  }

  const availableItems = menuItems.filter((item) => item.isAvailable && item.stockQuantity > 0).slice(0, 2);

  if (availableItems.length === 0) {
    throw new AppError(409, "No menu items are currently available.");
  }

  return availableItems.map((item) => ({
    sku: item.sku,
    quantity: 1
  }));
}

export function updateMenuItem(sku: string, input: UpdateMenuItemInput): MenuItem {
  const menuItem = menuBySku.get(sku);

  if (!menuItem) {
    throw new AppError(404, "Menu item not found.");
  }

  if (input.price !== undefined) {
    menuItem.price = input.price;
  }

  if (input.stockQuantity !== undefined) {
    menuItem.stockQuantity = input.stockQuantity;
  }

  if (input.isAvailable !== undefined) {
    menuItem.isAvailable = input.isAvailable;
  }

  publishAdminEvent("menu_updated");
  return menuItem;
}

export function assertMenuStock(items: Array<{ sku: string; quantity: number }>) {
  for (const item of items) {
    const menuItem = menuBySku.get(item.sku);

    if (!menuItem) {
      throw new AppError(400, `Unknown menu SKU: ${item.sku}`);
    }

    if (!menuItem.isAvailable) {
      throw new AppError(409, `${menuItem.name} is currently unavailable.`);
    }

    if (menuItem.stockQuantity < item.quantity) {
      throw new AppError(409, `${menuItem.name} only has ${menuItem.stockQuantity} item(s) left.`);
    }
  }
}

export function reserveMenuStock(items: Array<{ sku: string; quantity: number }>) {
  assertMenuStock(items);

  for (const item of items) {
    const menuItem = menuBySku.get(item.sku);

    if (menuItem) {
      menuItem.stockQuantity -= item.quantity;
      menuItem.isAvailable = menuItem.stockQuantity > 0;
    }
  }
}

export function releaseMenuStock(items: Array<{ sku: string; quantity: number }>) {
  for (const item of items) {
    const menuItem = menuBySku.get(item.sku);

    if (menuItem) {
      menuItem.stockQuantity += item.quantity;
      menuItem.isAvailable = true;
    }
  }
}

export function resetMenuForTest() {
  for (const initialItem of initialMenuItems) {
    const menuItem = menuBySku.get(initialItem.sku);

    if (menuItem) {
      Object.assign(menuItem, {
        ...initialItem,
        aliases: [...initialItem.aliases]
      });
    }
  }
}

export function normalizeSearchText(value: string): string {
  return stripVietnameseTones(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b7 up\b/g, "7up");
}

function findDefaultVariant(normalizedQuery: string): MenuItem | undefined {
  const defaultNames = new Map([
    ["7up", "7up regular"]
  ]);
  const defaultName = defaultNames.get(normalizedQuery);

  if (!defaultName) {
    return undefined;
  }

  return menuItems.find((item) => normalizeSearchText(item.name) === defaultName && item.isAvailable && item.stockQuantity > 0);
}

function scoreMenuItem(item: MenuItem, normalizedQuery: string): number {
  const searchableText = normalizeSearchText(`${item.name} ${item.slug} ${item.description}`);
  const normalizedAliases = item.aliases.map(normalizeSearchText);
  let score = 0;

  if (searchableText.includes(normalizedQuery)) {
    score = Math.max(score, 80 + normalizedQuery.length);
  }

  for (const alias of normalizedAliases) {
    if (alias && normalizedQuery.includes(alias)) {
      score = Math.max(score, 120 + alias.length);
    }
  }

  const queryWords = normalizedQuery.split(" ").filter((word) => word.length >= 2);
  const nameWords = normalizeSearchText(item.name).split(" ").filter((word) => word.length >= 2);
  let wordScore = 0;

  for (const queryWord of queryWords) {
    if (searchableText.includes(queryWord) || nameWords.some((nameWord) => nameWord.includes(queryWord))) {
      wordScore += 18;
      continue;
    }

    if (queryWord.length >= 4 && nameWords.some((nameWord) => isSmallTypo(queryWord, nameWord))) {
      wordScore += 14;
    }
  }

  if (wordScore > 0) {
    score = Math.max(score, wordScore);
  }

  if (score > 0 && item.isAvailable && item.stockQuantity > 0) {
    score += 5;
  }

  return score;
}

function isSmallTypo(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) {
    return false;
  }

  return levenshteinDistance(left, right) <= 1 || isAdjacentTransposition(left, right);
}

function isAdjacentTransposition(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const mismatches = [...left].map((character, index) => ({ character, index })).filter(({ character, index }) => character !== right[index]);

  return (
    mismatches.length === 2 &&
    mismatches[1].index === mismatches[0].index + 1 &&
    left[mismatches[0].index] === right[mismatches[1].index] &&
    left[mismatches[1].index] === right[mismatches[0].index]
  );
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function stripVietnameseTones(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}
