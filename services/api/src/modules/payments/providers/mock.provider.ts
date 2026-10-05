import type { Money, PaymentStatus } from '@mountain/types';
import type { PaymentProvider } from '../payments.provider.js';

/**
 * Mock provider — instantly succeeds so local development and tests run
 * without external payment credentials. Replaced by the Stripe provider.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly id = 'MOCK';

  private refs = new Map<string, PaymentStatus>();
  private seq = 0;

  async createPayment(input: { orderId: string; amount: Money }): Promise<{ providerRef: string; status: PaymentStatus }> {
    const ref = `mock_${++this.seq}_${input.orderId}`;
    this.refs.set(ref, 'SUCCEEDED');
    return { providerRef: ref, status: 'SUCCEEDED' };
  }

  async capturePayment(providerRef: string): Promise<{ status: PaymentStatus }> {
    const status = this.refs.get(providerRef);
    if (!status) throw new Error(`Unknown payment ref: ${providerRef}`);
    return { status };
  }

  async refundPayment(providerRef: string): Promise<{ status: PaymentStatus; refundRef: string }> {
    const status = this.refs.get(providerRef);
    if (!status) throw new Error(`Unknown payment ref: ${providerRef}`);
    this.refs.set(providerRef, 'REFUNDED');
    return { status: 'REFUNDED', refundRef: `refund_${providerRef}` };
  }

  async cancelPayment(providerRef: string): Promise<{ status: PaymentStatus }> {
    const status = this.refs.get(providerRef);
    if (!status) throw new Error(`Unknown payment ref: ${providerRef}`);
    this.refs.set(providerRef, 'CANCELLED');
    return { status: 'CANCELLED' };
  }

  async getPaymentStatus(providerRef: string): Promise<PaymentStatus> {
    const status = this.refs.get(providerRef);
    if (!status) throw new Error(`Unknown payment ref: ${providerRef}`);
    return status;
  }
}
