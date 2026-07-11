import type { MenuItem } from "../types.js";

export const menuItems: MenuItem[] = [
  {
    sku: "FRIED_CHICKEN_1PC",
    name: "Ga ran 1 mieng",
    category: "chicken",
    description: "1 mieng ga ran gion cay nhe.",
    price: 39000,
    aliases: ["ga ran", "1 mieng ga", "mot mieng ga"],
    isAvailable: true
  },
  {
    sku: "FRIED_CHICKEN_2PC",
    name: "Ga ran 2 mieng",
    category: "chicken",
    description: "2 mieng ga ran gion, phu hop bua chinh.",
    price: 69000,
    aliases: ["2 ga", "hai mieng ga", "ga ran 2 mieng"],
    isAvailable: true
  },
  {
    sku: "ZINGER_BURGER",
    name: "Burger Zinger",
    category: "burger",
    description: "Burger ga cay voi sot mayo va rau gion.",
    price: 55000,
    aliases: ["burger", "zinger", "burger zinger"],
    isAvailable: true
  },
  {
    sku: "COMBO_ZINGER",
    name: "Combo Zinger",
    category: "combo",
    description: "Burger Zinger, khoai tay vua va Pepsi.",
    price: 89000,
    aliases: ["combo zinger", "combo burger", "combo"],
    isAvailable: true
  },
  {
    sku: "FRIES_MEDIUM",
    name: "Khoai tay chien vua",
    category: "side",
    description: "Khoai tay chien gion co vua.",
    price: 29000,
    aliases: ["khoai", "khoai tay", "khoai tay chien"],
    isAvailable: true
  },
  {
    sku: "EGG_TART",
    name: "Banh trung",
    category: "side",
    description: "Banh tart trung nong, vo gion.",
    price: 18000,
    aliases: ["banh trung", "tart", "egg tart"],
    isAvailable: true
  },
  {
    sku: "PEPSI_REGULAR",
    name: "Pepsi vua",
    category: "drink",
    description: "Ly Pepsi co vua.",
    price: 20000,
    aliases: ["pepsi", "nuoc ngot", "coca"],
    isAvailable: true
  }
];

export const menuBySku = new Map(menuItems.map((item) => [item.sku, item]));
