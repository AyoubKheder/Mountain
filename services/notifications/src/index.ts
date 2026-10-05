/**
 * Mountain notifications — fan-out delivery across channels (spec section 22).
 * Channel senders are interfaces now; concrete providers (SMTP, SMS gateway,
 * FCM/APNs) are wired in phase 2.
 */

export type Channel = 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';

export interface NotificationMessage {
  tenantId: string;
  userId?: string;
  channel: Channel;
  type: string;
  subject?: string;
  body: string;
  payload?: Record<string, unknown>;
}

export interface ChannelSender {
  readonly channel: Channel;
  send(message: NotificationMessage): Promise<{ delivered: boolean; providerRef?: string }>;
}

const senders = new Map<Channel, ChannelSender>();

export function registerSender(sender: ChannelSender): void {
  senders.set(sender.channel, sender);
}

export async function dispatch(message: NotificationMessage): Promise<void> {
  const sender = senders.get(message.channel);
  if (!sender) {
    console.warn(`[notifications] no sender registered for ${message.channel}; dropping`);
    return;
  }
  await sender.send(message);
}

/** Fallback in-app sender — always available, stores nothing by default. */
class InAppSender implements ChannelSender {
  readonly channel: Channel = 'IN_APP';

  async send(message: NotificationMessage): Promise<{ delivered: boolean }> {
    console.log(`[notifications:in-app] ${message.type}: ${message.body}`);
    return { delivered: true };
  }
}

registerSender(new InAppSender());

// Event → notification mapping (spec section 22 trigger list).
export const TEMPLATE_BY_EVENT: Record<string, { channel: Channel; type: string; subject: string }> = {
  OrderCreated: { channel: 'EMAIL', type: 'order.created', subject: 'Your order is confirmed' },
  PaymentCompleted: { channel: 'EMAIL', type: 'payment.completed', subject: 'Payment received' },
  OrderShipped: { channel: 'EMAIL', type: 'order.shipped', subject: 'Your order has shipped' },
  OrderDelivered: { channel: 'EMAIL', type: 'order.delivered', subject: 'Your order was delivered' },
  InventoryChanged: { channel: 'IN_APP', type: 'inventory.changed', subject: 'Inventory updated' },
};
