export type MenuCategory = "chicken" | "burger" | "combo" | "side" | "drink";

export type PaymentMethod = "cod" | "vnpay";

export type OrderStatus = "CONFIRMED_COD" | "PENDING_PAYMENT" | "PAID" | "CANCELLED";

export type MenuItem = {
  sku: string;
  name: string;
  category: MenuCategory;
  description: string;
  price: number;
  aliases: string[];
  isAvailable: boolean;
};

export type CouponType = "percentage" | "fixed" | "free_shipping";

export type Coupon = {
  code: string;
  label: string;
  type: CouponType;
  value: number;
  minSubtotal: number;
  maxDiscount?: number;
  expiresAt: string;
  eligiblePaymentMethods?: PaymentMethod[];
  isActive: boolean;
};

export type QuoteInputItem = {
  sku: string;
  quantity: number;
};

export type QuoteInput = {
  items: QuoteInputItem[];
  couponCode?: string;
  paymentMethod?: PaymentMethod;
  deliveryAddress?: string;
};

export type QuoteLine = {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type CouponResult = {
  code: string;
  isApplied: boolean;
  discount: number;
  reason?: string;
};

export type OrderQuote = {
  items: QuoteLine[];
  subtotal: number;
  itemDiscount: number;
  deliveryFee: number;
  deliveryDiscount: number;
  total: number;
  coupon?: CouponResult;
  currency: "VND";
};

export type CustomerInfo = {
  name: string;
  phone: string;
  address: string;
};

export type Order = {
  id: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  customer: CustomerInfo;
  notes?: string;
  quote: OrderQuote;
  createdAt: string;
  updatedAt: string;
};
