import { readFileSync } from "node:fs";
import type { MenuCategory, MenuItem } from "../types.js";
import { englishCatalogItems, englishCategoryById } from "./menu-en.js";

type CatalogCategory = {
  id: string;
  name: string;
  slug: string;
  url: string;
  display_order: number;
};

type CatalogItem = {
  id: string;
  name: string;
  slug: string;
  type: string;
  category_ids: string[];
  description: string;
  price: number;
  original_price: number | null;
  currency: "VND";
  image_url: string;
  product_url: string;
  available: boolean;
};

type Catalog = {
  categories: CatalogCategory[];
  items: CatalogItem[];
};

const catalog = JSON.parse(
  readFileSync(new URL("../../assets/data/kfc_catalog.json", import.meta.url), "utf8")
) as Catalog;

if (englishCatalogItems.length !== catalog.items.length) {
  throw new Error(
    `English catalog has ${englishCatalogItems.length} items, but the source catalog has ${catalog.items.length}.`
  );
}

const missingEnglishCategories = catalog.categories.filter((category) => !englishCategoryById[category.id]);

if (missingEnglishCategories.length > 0) {
  throw new Error(`Missing English categories: ${missingEnglishCategories.map((category) => category.id).join(", ")}.`);
}

export const menuCategories: MenuCategory[] = catalog.categories.map((category) => ({
  id: category.id,
  name: englishCategoryById[category.id].name,
  slug: englishCategoryById[category.id].slug,
  displayOrder: category.display_order
}));

const categoryById = new Map(menuCategories.map((category) => [category.id, category]));

export const menuItems: MenuItem[] = catalog.items.map((item, index) => {
  const primaryCategoryId = item.category_ids[0] ?? "uncategorized";
  const primaryCategory = categoryById.get(primaryCategoryId);
  const englishItem = englishCatalogItems[index];

  return {
    orderId: `M${String(index + 1).padStart(3, "0")}`,
    sku: item.id,
    catalogId: item.id,
    slug: item.slug,
    name: englishItem.name,
    category: primaryCategoryId,
    categoryName: primaryCategory?.name ?? primaryCategoryId,
    categoryIds: item.category_ids,
    description: englishItem.description ?? englishItem.name,
    price: item.price,
    originalPrice: item.original_price,
    imageUrl: normalizeImageUrl(item.image_url),
    productUrl: item.product_url,
    stockQuantity: createInitialStock(index),
    aliases: createAliases(item, englishItem),
    isAvailable: item.available
  };
});

export const menuBySku = new Map(menuItems.map((item) => [item.sku, item]));
export const menuByOrderId = new Map(menuItems.map((item) => [item.orderId, item]));

function normalizeImageUrl(imageUrl: string): string {
  const imageFileName = imageUrl.split("/").pop();

  return imageFileName ? `/assets/image/${imageFileName}` : "";
}

function createInitialStock(index: number): number {
  return 18 + (index % 24);
}

function createAliases(item: CatalogItem, englishItem: (typeof englishCatalogItems)[number]): string[] {
  return [
    ...new Set([
      englishItem.name,
      ...(englishItem.aliases ?? []),
      item.name,
      item.slug,
      stripVietnameseTones(item.name),
      stripVietnameseTones(item.slug)
    ])
  ]
    .map((alias) => alias.toLowerCase())
    .filter(Boolean);
}

function stripVietnameseTones(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}
