/**
 * @mountain/types — shared domain types for the Mountain platform.
 * Mirrors the "Core Data Entities" section of the specification.
 */

export type ID = string;
export type ISODateString = string;

export interface TenantScoped {
  tenantId: ID;
}

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------

export type PlatformRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'FINANCE_ADMIN'
  | 'SUPPORT_ADMIN'
  | 'SECURITY_ADMIN'
  | 'MARKETING_ADMIN'
  | 'ANALYTICS_ADMIN';

export type MerchantRole =
  | 'OWNER'
  | 'MANAGER'
  | 'STAFF'
  | 'ACCOUNTANT'
  | 'MARKETING'
  | 'FULFILLMENT'
  | 'CUSTOMER_SUPPORT';

/** Granular permission in `resource.action` form (e.g. `products.read`). */
export type Permission = `${string}.${string}`;

export interface User {
  id: ID;
  email: string;
  firstName: string;
  lastName: string;
  platformRole?: PlatformRole;
  twoFactorEnabled: boolean;
  createdAt: ISODateString;
}

export interface Employee extends TenantScoped {
  id: ID;
  userId: ID;
  role: MerchantRole;
  permissions: Permission[];
  storeId?: ID;
}

// ---------------------------------------------------------------------------
// Tenancy & storefront
// ---------------------------------------------------------------------------

export interface Tenant {
  id: ID;
  name: string;
  ownerId: ID;
  plan: PlanId;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  createdAt: ISODateString;
}

export type PlanId = 'FREE' | 'STARTER' | 'PRO' | 'BUSINESS' | 'ENTERPRISE';

export interface Store extends TenantScoped {
  id: ID;
  name: string;
  slug: string;
  industry?: string;
  defaultCurrency: string;
  defaultLocale: string;
  published: boolean;
  themeId?: ID;
  createdAt: ISODateString;
}

export interface Domain extends TenantScoped {
  id: ID;
  storeId: ID;
  hostname: string;
  type: 'SUBDOMAIN' | 'CUSTOM';
  verified: boolean;
}

export interface PageComponent {
  type: string;
  props: Record<string, unknown>;
}

export interface Page extends TenantScoped {
  id: ID;
  storeId: ID;
  title: string;
  path: string;
  components: PageComponent[];
  published: boolean;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface Category extends TenantScoped {
  id: ID;
  storeId: ID;
  name: string;
  slug: string;
  parentId?: ID;
}

export interface ProductVariant {
  id: ID;
  sku: string;
  /** Dimension combination, e.g. { size: "M", color: "black" }. */
  options: Record<string, string>;
  price: Money;
  inventoryId?: ID;
}

export interface Product extends TenantScoped {
  id: ID;
  storeId: ID;
  title: string;
  description: string;
  brand?: string;
  categoryIds: ID[];
  tags: string[];
  media: ProductMedia[];
  variants: ProductVariant[];
  seo?: SeoMetadata;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  createdAt: ISODateString;
}

export interface ProductMedia {
  url: string;
  type: 'IMAGE' | 'VIDEO';
  alt?: string;
  position: number;
}

export interface SeoMetadata {
  title?: string;
  description?: string;
  keywords?: string[];
}

export interface Inventory extends TenantScoped {
  id: ID;
  variantId: ID;
  warehouseId: ID;
  /** Physical count. */
  stock: number;
  /** Committed to open orders. */
  reserved: number;
  incoming: number;
  damaged: number;
  returned: number;
}

// ---------------------------------------------------------------------------
// Customers, cart, orders
// ---------------------------------------------------------------------------

export interface Customer extends TenantScoped {
  id: ID;
  storeId: ID;
  email: string;
  firstName?: string;
  lastName?: string;
  addresses: Address[];
  createdAt: ISODateString;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export interface Cart extends TenantScoped {
  id: ID;
  storeId: ID;
  customerId?: ID;
  anonymousId?: ID;
  items: CartItem[];
  couponCode?: string;
  updatedAt: ISODateString;
}

export interface CartItem {
  variantId: ID;
  quantity: number;
}

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'RETURNED'
  | 'FAILED';

export interface Order extends TenantScoped {
  id: ID;
  storeId: ID;
  customerId?: ID;
  number: string;
  status: OrderStatus;
  items: OrderItem[];
  totals: OrderTotals;
  shippingAddress?: Address;
  billingAddress?: Address;
  paymentId?: ID;
  timeline: OrderTimelineEntry[];
  createdAt: ISODateString;
}

export interface OrderItem {
  productId: ID;
  variantId: ID;
  title: string;
  sku: string;
  quantity: number;
  unitPrice: Money;
}

export interface OrderTotals {
  subtotal: Money;
  discount?: Money;
  tax: Money;
  shipping: Money;
  total: Money;
}

export interface OrderTimelineEntry {
  status: OrderStatus;
  at: ISODateString;
  note?: string;
}

// ---------------------------------------------------------------------------
// Money & payments
// ---------------------------------------------------------------------------

export interface Money {
  amount: number;
  currency: string;
}

export type PaymentStatus = 'REQUIRES_ACTION' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';

export interface Payment extends TenantScoped {
  id: ID;
  orderId: ID;
  provider: PaymentProviderId;
  providerRef?: string;
  status: PaymentStatus;
  amount: Money;
  createdAt: ISODateString;
}

export type PaymentProviderId = 'STRIPE' | 'PAYPAL' | 'BANK_TRANSFER' | 'CASH_ON_DELIVERY' | 'LOCAL';

export interface Refund extends TenantScoped {
  id: ID;
  paymentId: ID;
  amount: Money;
  reason?: string;
  createdAt: ISODateString;
}

// ---------------------------------------------------------------------------
// Reviews, discounts, notifications, support
// ---------------------------------------------------------------------------

export type ReviewModerationState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REPORTED';

export interface Review extends TenantScoped {
  id: ID;
  productId: ID;
  customerId?: ID;
  rating: 1 | 2 | 3 | 4 | 5;
  text?: string;
  verifiedPurchase: boolean;
  state: ReviewModerationState;
  helpfulVotes: number;
  merchantResponse?: string;
}

export interface Discount extends TenantScoped {
  id: ID;
  storeId: ID;
  code?: string;
  type: 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING' | 'BUY_X_GET_Y';
  value?: number;
  startsAt?: ISODateString;
  endsAt?: ISODateString;
  active: boolean;
}

export interface Notification extends TenantScoped {
  id: ID;
  userId?: ID;
  channel: 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
  type: string;
  payload: Record<string, unknown>;
  readAt?: ISODateString;
  createdAt: ISODateString;
}

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';

export interface SupportTicket extends TenantScoped {
  id: ID;
  subject: string;
  status: TicketStatus;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assignedAgentId?: ID;
  messages: TicketMessage[];
}

export interface TicketMessage {
  authorId: ID;
  body: string;
  internal: boolean;
  at: ISODateString;
}

// ---------------------------------------------------------------------------
// Platform billing, audit & AI
// ---------------------------------------------------------------------------

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export interface Subscription {
  id: ID;
  tenantId: ID;
  plan: PlanId;
  status: SubscriptionStatus;
  currentPeriodEnd: ISODateString;
}

export interface Invoice {
  id: ID;
  tenantId: ID;
  subscriptionId: ID;
  amount: Money;
  paidAt?: ISODateString;
}

export interface AuditLog {
  id: ID;
  tenantId?: ID;
  actorId: ID;
  action: string;
  target?: string;
  ip?: string;
  at: ISODateString;
}

export interface AIRequest {
  id: ID;
  tenantId: ID;
  kind: AIRequestKind;
  tokensIn: number;
  tokensOut: number;
  createdAt: ISODateString;
}

export type AIRequestKind =
  | 'PRODUCT_DESCRIPTION'
  | 'SEO_CONTENT'
  | 'STORE_GENERATION'
  | 'ANALYTICS_QUESTION'
  | 'MARKETING_COPY'
  | 'CHAT';

// ---------------------------------------------------------------------------
// Events (section 26)
// ---------------------------------------------------------------------------

export type DomainEventName =
  | 'OrderCreated'
  | 'PaymentCompleted'
  | 'ProductCreated'
  | 'ProductUpdated'
  | 'InventoryChanged'
  | 'CustomerCreated'
  | 'OrderShipped'
  | 'OrderDelivered';

export interface DomainEvent<T = unknown> {
  id: ID;
  name: DomainEventName;
  tenantId: ID;
  occurredAt: ISODateString;
  payload: T;
}
