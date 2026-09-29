import { BadRequestException } from '@nestjs/common';

import { D2CPaymentService } from '../d2c/payment/d2c-payment.service';
import { PaymentProvider } from './ports/payment-provider.port';
import { PaymentWebhookController } from './payment-webhook.controller';

/**
 * Sprint 35 — the HTTP transport layer only. Signature/business validation
 * itself is exercised thoroughly in `opay-payment-provider.spec.ts`
 * (signature math) and `d2c-payment.service.spec.ts` (callback business
 * rules) — this file only proves the controller wires them together
 * correctly: an invalid signature is rejected here, in the transport
 * layer, before `D2CPaymentService` ever sees it.
 */
describe('PaymentWebhookController', () => {
  function makeController(verifyCallbackResult: ReturnType<PaymentProvider['verifyCallback']>) {
    const paymentProvider = {
      name: 'opay',
      createPayment: jest.fn(),
      verifyCallback: jest.fn().mockReturnValue(verifyCallbackResult),
    } as unknown as jest.Mocked<PaymentProvider>;
    const d2cPaymentService = {
      handleProviderCallback: jest.fn(),
      getPublicPaymentStatus: jest.fn(),
    } as unknown as jest.Mocked<D2CPaymentService>;
    const controller = new PaymentWebhookController(paymentProvider, d2cPaymentService);
    return { controller, paymentProvider, d2cPaymentService };
  }

  function makeRequest(body: Record<string, unknown>) {
    return {
      rawBody: Buffer.from(JSON.stringify(body)),
      body,
      headers: { 'content-type': 'application/json' },
    } as never;
  }

  describe('webhook', () => {
    it('rejects a callback with an invalid signature at the transport layer, never reaching D2CPaymentService', async () => {
      const { controller, d2cPaymentService } = makeController({
        valid: false,
        reason: 'Signature verification failed.',
      });

      await expect(controller.webhook(makeRequest({ payload: {}, sha512: 'bad' }))).rejects.toThrow(
        BadRequestException,
      );
      expect(d2cPaymentService.handleProviderCallback).not.toHaveBeenCalled();
    });

    it('passes a validly-signed callback through to D2CPaymentService and acknowledges it', async () => {
      const verified = {
        valid: true as const,
        callback: {
          reference: 'PAY-SO-000001',
          providerReference: 'OPAY-1',
          amount: 1500,
          currency: 'NGN',
          status: 'SUCCESS' as const,
        },
      };
      const { controller, d2cPaymentService } = makeController(verified);

      const response = await controller.webhook(makeRequest({ payload: {}, sha512: 'good' }));

      expect(response).toEqual({ received: true });
      expect(d2cPaymentService.handleProviderCallback).toHaveBeenCalledWith(verified);
    });

    it('never leaks the verification failure reason back to the HTTP caller', async () => {
      const { controller } = makeController({
        valid: false,
        reason: 'Signature verification failed.',
      });
      try {
        await controller.webhook(makeRequest({}));
        fail('expected to throw');
      } catch (error) {
        expect((error as BadRequestException).message).not.toContain(
          'Signature verification failed',
        );
      }
    });
  });

  describe('status', () => {
    it('delegates to D2CPaymentService.getPublicPaymentStatus with the raw reference param', () => {
      const { controller, d2cPaymentService } = makeController({
        valid: true,
        callback: {} as never,
      });
      controller.status('PAY-SO-000001');
      expect(d2cPaymentService.getPublicPaymentStatus).toHaveBeenCalledWith('PAY-SO-000001');
    });
  });
});
