/**
 * Mountain worker — consumes domain events (spec section 26) and performs
 * asynchronous work: stock reservation, analytics rollups, notifications, AI.
 *
 * Starts with an in-process bus + Redis lists; Kafka/RabbitMQ replaces the
 * transport in phase 3 without changing handler signatures.
 */

import type { DomainEvent, DomainEventName } from '@mountain/types';

type Handler = (event: DomainEvent) => Promise<void>;

const handlers = new Map<DomainEventName, Handler[]>();

export function on(name: DomainEventName, handler: Handler): void {
  const list = handlers.get(name) ?? [];
  list.push(handler);
  handlers.set(name, list);
}

export async function publish(event: DomainEvent): Promise<void> {
  const list = handlers.get(event.name) ?? [];
  for (const handler of list) {
    try {
      await handler(event);
    } catch (err) {
      console.error(`[worker] handler failed for ${event.name}:`, err);
    }
  }
}

// --- Handlers wired to spec section 26 fan-out ------------------------------

on('OrderCreated', async (event) => {
  console.log(`[worker] reserving stock for order event ${event.id}`);
  // TODO: decrement/reserve inventory, emit InventoryChanged.
});

on('PaymentCompleted', async (event) => {
  console.log(`[worker] confirming order ${String((event.payload as { orderId?: string }).orderId)}`);
  // TODO: transition order to CONFIRMED, enqueue confirmation email.
});

on('OrderShipped', async (event) => {
  console.log(`[worker] notifying customer of shipment ${event.id}`);
  // TODO: shipping notification via services/notifications.
});

on('OrderCreated', async (event) => {
  console.log(`[worker] recording analytics for ${event.id}`);
  // TODO: append to analytics store (ClickHouse in phase 3).
});

if (process.env.RUN_WORKER === '1') {
  console.log('[worker] running — polling for events (transport pending phase 3)');
  setInterval(() => {
    // TODO: replace with queue consumer loop (Kafka/RabbitMQ/Redis streams).
  }, 5000);
}
