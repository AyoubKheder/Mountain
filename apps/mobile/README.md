# Mountain Mobile

Flutter apps for Android and iOS (spec section 30):

- `merchant/` — Mountain Merchant: dashboard, orders, products, customers, analytics, notifications
- `customer/` — Mountain Customer: store discovery, search, cart, checkout, orders, wishlist

Scaffold intentionally deferred: Flutter requires its own toolchain (`flutter create`).
Structure and API contracts are defined by `@mountain/types` and `@mountain/api`.
