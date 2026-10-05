import os

from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.units import cm

# /mnt/data doesn't exist on Windows; write next to the script instead.
os.makedirs("output", exist_ok=True)
path = os.path.join("output", "Mountain_Advanced_Ecommerce_Platform_Specification.pdf")

doc = SimpleDocTemplate(
    path, pagesize=A4,
    rightMargin=1.5*cm, leftMargin=1.5*cm,
    topMargin=1.5*cm, bottomMargin=1.5*cm
)

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="TitleCenter", parent=styles["Title"], alignment=TA_CENTER, fontSize=26, leading=32, spaceAfter=18))
styles.add(ParagraphStyle(name="SubCenter", parent=styles["Normal"], alignment=TA_CENTER, fontSize=12, leading=18, spaceAfter=20))
styles.add(ParagraphStyle(name="H1x", parent=styles["Heading1"], fontSize=18, leading=23, spaceBefore=14, spaceAfter=9))
styles.add(ParagraphStyle(name="H2x", parent=styles["Heading2"], fontSize=13, leading=17, spaceBefore=10, spaceAfter=6))
styles.add(ParagraphStyle(name="Bodyx", parent=styles["BodyText"], fontSize=9.5, leading=14, spaceAfter=6))
styles.add(ParagraphStyle(name="CodeX", parent=styles["BodyText"], fontName="Courier", fontSize=7.5, leading=10, leftIndent=10, spaceAfter=7))
styles.add(ParagraphStyle(name="Small", parent=styles["BodyText"], fontSize=8, leading=11))

story = []

def p(txt, style="Bodyx"):
    story.append(Paragraph(txt, styles[style]))

def h1(txt):
    story.append(Paragraph(txt, styles["H1x"]))

def h2(txt):
    story.append(Paragraph(txt, styles["H2x"]))

def code(txt):
    story.append(Paragraph(txt.replace("\n","<br/>").replace(" ","&nbsp;"), styles["CodeX"]))

def bullets(items):
    for x in items:
        p("• " + x)

story += [
    Spacer(1, 2*cm),
    Paragraph("🏔️ MOUNTAIN", styles["TitleCenter"]),
    Paragraph("Advanced Multi-Tenant E-Commerce SaaS Platform", styles["SubCenter"]),
    Paragraph("Product & Technical Specification — Client, Merchant, Admin, AI, Infrastructure & Scalability", styles["SubCenter"]),
    Spacer(1, 1*cm),
    Paragraph("<b>Vision:</b> Build Mountain as a serious commerce operating system where merchants can create, customize and operate complete online stores from one platform.", styles["Bodyx"]),
    Spacer(1, 1*cm),
    Paragraph("<b>Document scope:</b> Product architecture, applications, modules, data model, APIs, security, payments, AI, analytics, infrastructure, DevOps and phased development strategy.", styles["Bodyx"]),
    PageBreak()
]

h1("1. Product Vision")
p("Mountain is a multi-tenant SaaS platform inspired by the store-building model of Shopify. One platform serves many independent merchants, while each merchant receives an isolated store, catalog, customers, orders, inventory, settings and analytics.")
code("""MOUNTAIN PLATFORM
        |
  +-----+------+----------------+
  |            |                |
Merchant     Storefront       Admin
  |            |                |
  +------------+----------------+
               |
          API / Services
               |
   Database / Payments / Search
        / AI / Storage""")

h1("2. Applications")
h2("2.1 Mountain Merchant")
bullets(["Account and profile management", "Store creation and configuration", "Products, variants and categories", "Inventory and warehouses", "Orders and customers", "Discounts and marketing", "Shipping and payments", "Analytics", "AI tools", "Employees and permissions", "Subscription and billing"])

h2("2.2 Mountain Storefront")
bullets(["Public store generated for each merchant", "Home, catalog, categories and product pages", "Search and filters", "Cart and checkout", "Customer accounts", "Wishlist and reviews", "Order tracking", "Responsive/mobile-first design", "Custom domains"])

h2("2.3 Mountain Admin")
bullets(["Global platform dashboard", "Merchant and user management", "Subscriptions, invoices and transactions", "Support and tickets", "Security and audit logs", "Fraud monitoring", "System health and API monitoring", "AI usage and cost monitoring", "Marketing and platform settings"])

h1("3. Multi-Tenant Architecture")
p("Mountain must be designed as a multi-tenant SaaS. Each merchant is represented by a tenant, and every tenant-owned resource must be isolated using tenant-aware authorization and database queries.")
code("""Tenant
  |
  +-- Users
  +-- Store
  +-- Products
  +-- Customers
  +-- Orders
  +-- Inventory
  +-- Employees
  +-- Settings

Every tenant-owned record:
{
  id,
  tenantId,
  ...
}""")
p("<b>Critical rule:</b> never query tenant-owned resources without resolving and validating the current tenant ID.")

h1("4. Roles & Permissions")
h2("Platform roles")
bullets(["SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "SUPPORT_ADMIN", "SECURITY_ADMIN", "MARKETING_ADMIN", "ANALYTICS_ADMIN"])
h2("Merchant roles")
bullets(["OWNER", "MANAGER", "STAFF", "ACCOUNTANT", "MARKETING", "FULFILLMENT", "CUSTOMER_SUPPORT"])
p("Use RBAC with granular permissions such as products.read, products.create, orders.read, orders.update, orders.refund, analytics.read and settings.update.")

h1("5. Store Creation")
code("""Create account
    ↓
Store name
    ↓
Industry / country / currency
    ↓
Template selection
    ↓
Add products
    ↓
Payment configuration
    ↓
Shipping configuration
    ↓
Publish""")
bullets(["Automatic store setup", "Theme and page initialization", "Navigation generation", "Policy pages", "Checkout configuration", "SEO defaults", "Domain setup"])

h1("6. Store Builder")
p("A component-based drag-and-drop builder allows merchants to create pages without coding.")
bullets(["Hero", "Banner", "Product grid", "Product carousel", "Categories", "Testimonials", "Reviews", "FAQ", "Newsletter", "Video", "Image", "Text", "Countdown", "Social media", "Featured products", "Best sellers", "Custom HTML"])
p("Pages should be represented as structured components/configuration rather than hardcoded templates.")

h1("7. Custom Domains")
code("""Customer
   ↓
Custom domain
   ↓
Cloudflare / CDN
   ↓
Mountain Gateway
   ↓
Tenant Resolver
   ↓
Storefront""")
bullets(["DNS verification", "SSL/HTTPS", "Domain routing", "Custom domains and subdomains", "Tenant resolution"])

h1("8. Product System")
bullets(["Product title and description", "SKU", "Brand", "Category", "Tags", "Images and videos", "Variants", "Pricing", "Inventory", "Shipping information", "SEO metadata", "Reviews", "Custom metadata"])
h2("Variants")
p("Products can have dimensions such as size, color and material. Each combination can have its own SKU, price and stock.")

h1("9. Inventory & Warehouses")
bullets(["Stock", "Reserved", "Available", "Incoming", "Damaged", "Returned", "Multiple warehouses", "Low-stock alerts", "Inventory synchronization"])
p("A typical availability formula is: Available = Stock − Reserved.")

h1("10. Orders")
code("""PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED
                    ↘ CANCELLED / REFUNDED / RETURNED / FAILED""")
bullets(["Customer", "Products and variants", "Quantity", "Subtotal", "Discount", "Tax", "Shipping", "Total", "Payment", "Addresses", "Tracking", "Order timeline"])

h1("11. Payments")
p("Create a provider abstraction so Mountain is not tightly coupled to one payment provider.")
bullets(["Stripe", "PayPal", "Bank transfer", "Cash on delivery", "Local payment providers"])
p("Payment provider interface: createPayment(), capturePayment(), refundPayment(), cancelPayment(), getPaymentStatus().")

h1("12. Mountain Business Model")
bullets(["Free", "Starter", "Pro", "Business", "Enterprise"])
p("Potential revenue sources include subscriptions, transaction fees, premium features, AI usage and extra storage. Pricing should be configurable rather than hardcoded into the core application.")

h1("13. AI Platform")
bullets(["AI product title and description generation", "SEO content generation", "Product image enhancement", "Background removal", "AI store generation", "Sales analysis", "Recommendations", "Demand forecasting", "Fraud detection", "Customer segmentation", "AI chatbot", "Marketing assistance"])
code("""Mountain Backend
      ↓
   AI Gateway
      ↓
Python AI Services
  /      |       \\
NLP   Vision   Recommendation
  \\      |       /
      AI Models""")

h1("14. AI Store Builder")
p("A merchant can describe the desired business in natural language, for example: “Create an online clothing store for young men.” The system can prepare a theme, colors, homepage structure, categories, navigation, product sections, marketing copy and SEO defaults. The merchant remains in control and approves the generated result.")

h1("15. AI Analytics Assistant")
p("The assistant should answer business questions using actual store data such as sales, orders, products, traffic, customers and inventory. It should distinguish measured data from generated explanations and avoid inventing metrics.")

h1("16. Search")
bullets(["Full-text search", "Autocomplete", "Filters", "Facets", "Typo tolerance", "Synonyms", "Ranking", "Recommendations", "Trending products"])
p("Recommended architecture: MongoDB as source of commerce data, with OpenSearch/Elasticsearch as a dedicated search index.")

h1("17. Recommendation Engine")
p("Recommendations can use views, clicks, searches, purchases, carts, wishlists and categories.")
bullets(["You may also like", "Frequently bought together", "Recommended for you", "Similar products", "Trending products"])

h1("18. Analytics")
bullets(["Revenue", "Orders", "Customers", "Conversion rate", "Average order value", "Traffic", "Sessions", "Cart abandonment", "Returning customers", "Product performance"])
code("""Visitors
   ↓
Product Views
   ↓
Add to Cart
   ↓
Checkout
   ↓
Purchase""")

h1("19. Cart & Customer Accounts")
bullets(["Guest cart", "Authenticated cart", "Persistent cart", "Cart merging after login", "Coupons", "Variants", "Quantity validation", "Inventory validation", "Shipping estimation"])
bullets(["Profile", "Addresses", "Orders", "Wishlist", "Reviews", "Returns", "Saved payment methods", "Notifications"])

h1("20. Reviews")
bullets(["Rating", "Text", "Images", "Verified purchase", "Helpful votes", "Merchant response", "Moderation", "Reporting"])
p("Moderation states: PENDING, APPROVED, REJECTED, REPORTED.")

h1("21. Marketing")
bullets(["Coupons", "Discount codes", "Automatic discounts", "Flash sales", "Bundles", "Free shipping", "Buy X Get Y", "Email campaigns", "Push notifications", "Abandoned-cart campaigns"])

h1("22. Notifications")
code("""Notification Service
       |
 +-----+------+------+
 |            |      |
Email         SMS    Push
 |
 +-- In-app""")
bullets(["Order created", "Payment successful", "Order shipped", "Order delivered", "Refund", "Low inventory", "New customer", "New review", "Subscription events"])

h1("23. Security")
bullets(["OAuth2/JWT authentication", "Refresh tokens", "2FA", "RBAC", "Rate limiting", "API gateway", "Input validation", "Encryption", "Secrets management", "Audit logs", "Session management", "CSRF protection", "CORS policy", "Security headers", "Password hashing with Argon2id"])
p("Never store raw payment card details. Use compliant payment providers and tokenized payment flows.")

h1("24. Fraud Detection")
bullets(["IP/device signals", "Transaction velocity", "Failed payments", "Country/location signals", "Transaction amount", "Multiple-account patterns", "Suspicious order behavior"])
p("Use the fraud engine to route transactions to normal processing, additional review or blocking according to configurable rules.")

h1("25. Backend Architecture")
p("Start with a modular monolith rather than immediately creating many microservices. Keep domains separated so high-load components can later be extracted.")
code("""Backend
├── Auth
├── Users
├── Tenants
├── Stores
├── Products
├── Categories
├── Inventory
├── Orders
├── Payments
├── Customers
├── Reviews
├── Discounts
├── Shipping
├── Notifications
├── Analytics
├── Search
├── AI
├── Billing
└── Admin""")

h1("26. Event-Driven Architecture")
p("Use domain events for asynchronous work and future service separation.")
bullets(["OrderCreated", "PaymentCompleted", "ProductCreated", "ProductUpdated", "InventoryChanged", "CustomerCreated", "OrderShipped", "OrderDelivered"])
code("""Customer buys product
       ↓
OrderCreated
       ↓
  +----+--------+--------+
  ↓    ↓        ↓        ↓
Stock Analytics Email     AI""")

h1("27. Caching")
p("Redis can be used for sessions, carts, product/store configuration caching, rate limiting and temporary data.")

h1("28. Data Architecture")
p("Initial stack can use MongoDB for flexible commerce data. At larger scale, specialized storage can be introduced.")
bullets(["PostgreSQL — transactional/financial data where appropriate", "MongoDB — flexible commerce/catalog data", "Redis — cache and sessions", "OpenSearch — search", "S3-compatible storage — images/files", "ClickHouse — high-volume analytics"])

h1("29. Cloud Architecture")
code("""Cloudflare / CDN
       ↓
Load Balancer
       ↓
API Gateway
       ↓
+-------------------+
| Backend           |
| Storefront        |
+-------------------+
       ↓
MongoDB / Redis / Queue
       ↓
Workers / External Services""")
bullets(["Docker", "Kubernetes when scale justifies it", "CI/CD", "Infrastructure as Code with Terraform", "Object storage", "CDN", "Secrets management"])

h1("30. Mobile Applications")
h2("Mountain Merchant")
bullets(["Dashboard", "Orders", "Products", "Customers", "Analytics", "Notifications"])
h2("Mountain Customer")
bullets(["Store discovery", "Search", "Cart", "Checkout", "Orders", "Wishlist"])
p("Flutter can provide one cross-platform codebase for Android and iOS.")

h1("31. Recommended Technology Stack")
data = [
    ["Layer", "Technology"],
    ["Merchant Web", "React + TypeScript"],
    ["Storefront", "Next.js"],
    ["Admin", "React + TypeScript"],
    ["Backend", "Node.js + NestJS"],
    ["Database", "MongoDB"],
    ["Cache", "Redis"],
    ["Search", "OpenSearch"],
    ["Queue/Eventing", "Kafka or RabbitMQ"],
    ["Storage", "S3-compatible object storage"],
    ["Payments", "Stripe + local providers"],
    ["AI", "Python + FastAPI"],
    ["AI Models", "PyTorch / TensorFlow"],
    ["Mobile", "Flutter"],
    ["Auth", "OAuth2 + JWT + 2FA"],
    ["API", "REST + WebSocket"],
    ["Containers", "Docker"],
    ["Infrastructure", "Kubernetes"],
    ["CI/CD", "GitHub Actions"],
    ["Observability", "OpenTelemetry + metrics/logging stack"],
    ["CDN/Security", "Cloudflare"]
]
t = Table(data, colWidths=[5*cm, 11*cm], repeatRows=1)
t.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#222222")),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("GRID", (0,0), (-1,-1), 0.3, colors.grey),
    ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("FONTSIZE", (0,0), (-1,-1), 8),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#f5f5f5")]),
]))
story.append(t)

h1("32. Project Structure")
code("""mountain/
├── apps/
│   ├── merchant/
│   ├── storefront/
│   ├── admin/
│   └── mobile/
├── services/
│   ├── api/
│   ├── ai/
│   ├── worker/
│   ├── search/
│   └── notifications/
├── packages/
│   ├── ui/
│   ├── types/
│   ├── config/
│   ├── auth/
│   └── utils/
├── infrastructure/
│   ├── docker/
│   ├── kubernetes/
│   └── terraform/
└── docs/""")

h1("33. Core Data Entities")
bullets(["User", "Tenant", "Store", "Domain", "Theme", "Page", "Product", "ProductVariant", "Category", "Inventory", "Warehouse", "Customer", "Cart", "CartItem", "Order", "OrderItem", "Payment", "Refund", "Shipment", "Coupon", "Discount", "Review", "Wishlist", "Subscription", "Invoice", "Notification", "AuditLog", "Employee", "Role", "Permission", "AIRequest", "AnalyticsEvent"])

h1("34. Admin Command Center")
bullets(["Platform overview", "Users, merchants and stores", "Customers", "Orders and products", "Subscriptions and payments", "Revenue and platform metrics", "Support tickets", "Security and audit logs", "Infrastructure health", "API performance", "AI usage and costs"])
p("Merchant detail should provide a controlled operational view of the merchant's store, subscription, activity and support history.")

h1("35. Support System")
bullets(["Tickets", "Conversations", "Attachments", "Priority", "Status", "Assigned agent", "Internal notes"])
p("Suggested statuses: OPEN, IN_PROGRESS, WAITING_CUSTOMER, RESOLVED, CLOSED.")

h1("36. Internationalization")
bullets(["French", "English", "Arabic", "RTL support", "Locale-aware dates and numbers", "Currencies", "Time zones", "Tax rules"])
p("The platform should be localization-ready from the first version rather than adding translation architecture later.")

h1("37. Multi-Currency & Tax")
p("Store and customer contexts may determine currency, language, tax and shipping rules. Currency and tax logic should be isolated services/modules rather than hardcoded into checkout.")

h1("38. Quality & DevOps")
bullets(["Unit tests", "Integration tests", "End-to-end tests", "API tests", "Security tests", "Load tests", "Pull-request checks", "Dependency/security scanning", "Docker builds", "Staging deployment", "Automated E2E", "Production deployment", "Observability"])

h1("39. SaaS Metrics")
bullets(["MRR", "ARR", "Active merchants", "Active stores", "New stores", "Churn", "Subscription upgrades/downgrades", "GMV", "Orders", "Average revenue per merchant", "AI usage", "Infrastructure cost"])

h1("40. Long-Term Positioning")
p("Mountain can evolve from a store builder into an AI-powered commerce operating system.")
code("""Create Store
    ↓
AI Builds Store
    ↓
AI Helps Add Products
    ↓
AI Optimizes SEO
    ↓
AI Analyzes Customers
    ↓
AI Recommends Products
    ↓
AI Helps Marketing
    ↓
AI Predicts Demand
    ↓
Merchant Controls Everything""")

h1("41. Development Roadmap")
h2("Phase 1 — Core")
bullets(["Authentication", "Multi-tenancy", "Store creation", "Products", "Categories", "Cart", "Checkout", "Orders", "Merchant dashboard", "Admin dashboard"])

h2("Phase 2 — Professional")
bullets(["Themes", "Page builder", "Custom domains", "Payments", "Shipping", "Inventory", "Coupons", "Reviews", "Analytics", "Notifications"])

h2("Phase 3 — Advanced")
bullets(["Search", "Recommendations", "Multi-warehouse", "Subscriptions", "Mobile apps", "Event-driven architecture", "Advanced analytics"])

h2("Phase 4 — AI")
bullets(["AI Store Builder", "AI Product Generator", "AI SEO", "AI Analytics", "AI Recommendations", "AI Marketing", "AI Customer Assistant", "AI Forecasting"])

h1("42. Final Architecture")
code("""                         MOUNTAIN
                            |
          +-----------------+-----------------+
          |                 |                 |
       MERCHANT          STOREFRONT          ADMIN
          |                 |                 |
          +-----------------+-----------------+
                            |
                       API PLATFORM
                            |
       +------------+-------+--------+------------+
       |            |                |            |
    Commerce      Payment           AI         Search
       |            |                |            |
       +------------+-------+--------+------------+
                            |
                       DATA PLATFORM
                            |
             +--------------+--------------+
             |              |              |
          MongoDB         Redis            S3
             |
           Events
             |
           Kafka
             |
          Workers
             |
        AI / Analytics""")

h1("43. Product Principle")
p("<b>Build Mountain as a platform, not a website.</b> The core architecture should make it possible for many merchants to independently operate stores while Mountain centrally provides identity, commerce infrastructure, payments, analytics, AI, security and administration.")
p("The architecture is intentionally designed so the first production release can start as a modular monolith and progressively extract high-load domains into services as usage grows.")

doc.build(story)

print(path)
