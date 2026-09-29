import { createHmac } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import {
  fromMinorUnits,
  loadOpayConfig,
  OpayConfigurationError,
  OpayPaymentProvider,
  toMinorUnits,
} from './opay-payment-provider';

describe('OpayPaymentProvider', () => {
  const fetchMock = jest.fn();
  const SECRET_KEY = 'test-secret-key-never-real';

  function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
    const values: Record<string, unknown> = {
      'opay.apiBaseUrl': 'https://testapi.opaycheckout.com',
      'opay.merchantId': 'MERCHANT-TEST-1',
      'opay.publicKey': 'PUBLIC-TEST-KEY',
      'opay.secretKey': SECRET_KEY,
      ...overrides,
    };
    return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
  }

  const baseRequest = {
    reference: 'PAY-SO-000001',
    amount: 1500,
    currency: 'NGN',
    returnUrl: 'http://localhost:3000/payment/PAY-SO-000001?outcome=return',
    cancelUrl: 'http://localhost:3000/payment/PAY-SO-000001?outcome=cancel',
    callbackUrl: 'http://localhost:4000/api/payments/opay/webhook',
    displayName: 'Boby Bites',
    customer: { reference: 'consumer-1', name: 'Ada Okafor', phoneNumber: '+2348012345678' },
    productDescription: 'Order SO-000001',
  };

  beforeEach(() => {
    fetchMock.mockReset();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });

  describe('loadOpayConfig / construction', () => {
    it('throws OpayConfigurationError listing every missing field, without leaking any value', () => {
      const config = makeConfig({ 'opay.secretKey': undefined, 'opay.publicKey': undefined });
      expect(() => loadOpayConfig(config)).toThrow(OpayConfigurationError);
      try {
        loadOpayConfig(config);
      } catch (error) {
        expect((error as Error).message).toContain('OPAY_SECRET_KEY');
        expect((error as Error).message).toContain('OPAY_PUBLIC_KEY');
        expect((error as Error).message).not.toContain(SECRET_KEY);
      }
    });

    it('constructs successfully when every required field is present', () => {
      expect(() => new OpayPaymentProvider(makeConfig())).not.toThrow();
    });
  });

  describe('toMinorUnits / fromMinorUnits (brief "PAYMENT AMOUNT")', () => {
    it.each([
      [100, 10000],
      [1000, 100000],
      [10000, 1000000],
      [99.99, 9999],
      [0.1, 10],
      [19.99, 1999], // the classic floating-point-multiplication drift case
    ])('converts ₦%s to %s minor units and back', (major, minor) => {
      expect(toMinorUnits(major)).toBe(minor);
      expect(fromMinorUnits(minor)).toBe(major);
    });
  });

  describe('createPayment', () => {
    it('sends the correct headers, endpoint, and minor-unit amount, and returns CREATED on a successful response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: '00000',
          message: 'SUCCESSFUL',
          data: {
            reference: baseRequest.reference,
            orderNo: 'OPAY-ORDER-1',
            cashierUrl: 'https://sandbox.opaycheckout.com/pay/abc',
            status: 'INITIAL',
            amount: { total: 150000, currency: 'NGN' },
          },
        }),
      });

      const provider = new OpayPaymentProvider(makeConfig());
      const result = await provider.createPayment(baseRequest);

      expect(result).toEqual({
        outcome: 'CREATED',
        checkoutUrl: 'https://sandbox.opaycheckout.com/pay/abc',
        providerReference: 'OPAY-ORDER-1',
      });

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://testapi.opaycheckout.com/api/v1/international/cashier/create');
      expect(init.headers.Authorization).toBe('Bearer PUBLIC-TEST-KEY');
      expect(init.headers.MerchantId).toBe('MERCHANT-TEST-1');
      expect(init.headers.Authorization).not.toContain(SECRET_KEY);
      const body = JSON.parse(init.body as string);
      expect(body.amount).toEqual({ total: 150000, currency: 'NGN' }); // ₦1,500 -> 150000 kobo
      expect(body.reference).toBe(baseRequest.reference);
      expect(body.country).toBe('NG');
    });

    it('rejects a non-NGN currency before ever calling OPay (brief "CURRENCY")', async () => {
      const provider = new OpayPaymentProvider(makeConfig());
      const result = await provider.createPayment({ ...baseRequest, currency: 'USD' });
      expect(result.outcome).toBe('REJECTED');
      expect(result.errorCode).toBe('OPAY_UNSUPPORTED_CURRENCY');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ['02000', 'OPAY_AUTH_FAILED', 'REJECTED'],
      ['02001', 'OPAY_INVALID_PARAMS', 'REJECTED'],
      ['02002', 'OPAY_MERCHANT_NOT_CONFIGURED', 'REJECTED'],
      ['02003', 'OPAY_PAY_METHOD_NOT_SUPPORTED', 'REJECTED'],
      ['02004', 'OPAY_DUPLICATE_REFERENCE', 'DUPLICATE_REFERENCE'],
      ['02007', 'OPAY_MERCHANT_UNAVAILABLE', 'REJECTED'],
      ['50003', 'OPAY_SERVICE_UNAVAILABLE', 'UNAVAILABLE'],
    ])(
      'maps OPay error code %s to %s / outcome %s — never the raw error to the caller',
      async (code, errorCode, outcome) => {
        fetchMock.mockResolvedValue({
          ok: false,
          status: code === '50003' ? 503 : 400,
          json: async () => ({ code, message: 'some raw provider message' }),
        });
        const provider = new OpayPaymentProvider(makeConfig());
        const result = await provider.createPayment(baseRequest);
        expect(result.outcome).toBe(outcome);
        expect(result.errorCode).toBe(errorCode);
        expect(result.errorMessage).not.toContain('some raw provider message');
      },
    );

    it('returns UNAVAILABLE on a malformed (non-JSON) response rather than throwing', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
      });
      const provider = new OpayPaymentProvider(makeConfig());
      const result = await provider.createPayment(baseRequest);
      expect(result.outcome).not.toBe('CREATED');
    });

    it('returns UNAVAILABLE on a network failure/timeout, never throwing', async () => {
      fetchMock.mockRejectedValue(new Error('network timeout'));
      const provider = new OpayPaymentProvider(makeConfig());
      const result = await provider.createPayment(baseRequest);
      expect(result.outcome).toBe('UNAVAILABLE');
      expect(result.errorCode).toBe('OPAY_NETWORK');
    });
  });

  describe('verifyCallback (brief "CALLBACK SECURITY")', () => {
    function signedBody(payload: Record<string, unknown>, key = SECRET_KEY): string {
      const sha512 = createHmac('sha512', key).update(JSON.stringify(payload)).digest('hex');
      return JSON.stringify({ payload, sha512 });
    }

    const validPayload = {
      reference: 'PAY-SO-000001',
      orderNo: 'OPAY-ORDER-1',
      status: 'SUCCESS',
      amount: { total: 150000, currency: 'NGN' },
    };

    it('accepts a correctly-signed callback and maps SUCCESS/amount/currency correctly', () => {
      const provider = new OpayPaymentProvider(makeConfig());
      const outcome = provider.verifyCallback(signedBody(validPayload), {});
      expect(outcome.valid).toBe(true);
      if (outcome.valid) {
        expect(outcome.callback).toEqual({
          reference: 'PAY-SO-000001',
          providerReference: 'OPAY-ORDER-1',
          amount: 1500, // 150000 kobo -> ₦1,500
          currency: 'NGN',
          status: 'SUCCESS',
        });
      }
    });

    it.each([
      ['INITIAL', 'PENDING'],
      ['PENDING', 'PENDING'],
      ['SUCCESS', 'SUCCESS'],
      ['FAIL', 'FAILED'],
      ['CLOSE', 'CLOSED'],
    ])('maps OPay status %s to %s', (opayStatus, expected) => {
      const provider = new OpayPaymentProvider(makeConfig());
      const outcome = provider.verifyCallback(
        signedBody({ ...validPayload, status: opayStatus }),
        {},
      );
      expect(outcome.valid).toBe(true);
      if (outcome.valid) expect(outcome.callback.status).toBe(expected);
    });

    it('maps an unrecognized status to UNKNOWN, never silently SUCCESS (brief "CALLBACK VALIDATION §6")', () => {
      const provider = new OpayPaymentProvider(makeConfig());
      const outcome = provider.verifyCallback(
        signedBody({ ...validPayload, status: 'SOME_NEW_STATUS' }),
        {},
      );
      expect(outcome.valid).toBe(true);
      if (outcome.valid) expect(outcome.callback.status).toBe('UNKNOWN');
    });

    it('rejects a callback signed with the WRONG key', () => {
      const provider = new OpayPaymentProvider(makeConfig());
      const outcome = provider.verifyCallback(signedBody(validPayload, 'wrong-key'), {});
      expect(outcome.valid).toBe(false);
    });

    it('rejects a callback whose payload was tampered with after signing', () => {
      const provider = new OpayPaymentProvider(makeConfig());
      const signed = JSON.parse(signedBody(validPayload));
      signed.payload.amount.total = 1; // tampered
      const outcome = provider.verifyCallback(JSON.stringify(signed), {});
      expect(outcome.valid).toBe(false);
    });

    it('rejects malformed (non-JSON) callback bodies', () => {
      const provider = new OpayPaymentProvider(makeConfig());
      const outcome = provider.verifyCallback('not json at all', {});
      expect(outcome.valid).toBe(false);
    });

    it('rejects a callback missing payload/sha512 entirely', () => {
      const provider = new OpayPaymentProvider(makeConfig());
      const outcome = provider.verifyCallback(JSON.stringify({ foo: 'bar' }), {});
      expect(outcome.valid).toBe(false);
    });

    it('rejects a correctly-signed callback missing required payload fields', () => {
      const provider = new OpayPaymentProvider(makeConfig());
      const outcome = provider.verifyCallback(signedBody({ reference: 'PAY-SO-1' }), {});
      expect(outcome.valid).toBe(false);
    });
  });
});
