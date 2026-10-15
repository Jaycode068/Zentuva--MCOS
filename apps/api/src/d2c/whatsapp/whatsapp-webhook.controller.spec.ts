import { createHmac } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { WhatsAppConfigurationError } from '../../notifications/infrastructure/meta-whatsapp-provider';
import { WhatsAppInboundAdapterService } from './whatsapp-inbound-adapter.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

describe('WhatsAppWebhookController', () => {
  function makeResponse() {
    return { status: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() };
  }

  // `configValues` is a plain, mutable object — the returned `config.get` mock reads
  // it live on every call (never snapshotted), so a test can mutate it AFTER
  // construction to simulate a config value changing between app boot and a later
  // request (Stage 5C.1's defensive "reject anyway" test relies on exactly this).
  function makeController(configValues: Record<string, unknown>) {
    const config = { get: jest.fn((key: string) => configValues[key]) } as unknown as ConfigService;
    const adapter = {
      handleWebhookPayload: jest.fn().mockResolvedValue(undefined),
    } as unknown as WhatsAppInboundAdapterService;
    return { controller: new WhatsAppWebhookController(config, adapter), adapter };
  }

  function makeRequest(body: unknown, appSecret?: string) {
    const rawBody = Buffer.from(JSON.stringify(body));
    const headers: Record<string, string> = {};
    if (appSecret) {
      const signature = createHmac('sha256', appSecret).update(rawBody).digest('hex');
      headers['x-hub-signature-256'] = `sha256=${signature}`;
    }
    return { rawBody, body, headers } as never;
  }

  describe('GET /whatsapp/webhook — verification handshake', () => {
    it('echoes hub.challenge verbatim when mode=subscribe and the verify token matches', () => {
      const { controller } = makeController({ 'whatsapp.webhookVerifyToken': 'secret-verify' });
      const res = makeResponse();
      controller.verify('subscribe', 'secret-verify', 'challenge-123', res as never);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('challenge-123');
    });

    it('rejects with 403 when the verify token does not match', () => {
      const { controller } = makeController({ 'whatsapp.webhookVerifyToken': 'secret-verify' });
      const res = makeResponse();
      controller.verify('subscribe', 'wrong-token', 'challenge-123', res as never);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('rejects with 403 when no verify token is configured at all', () => {
      const { controller } = makeController({});
      const res = makeResponse();
      controller.verify('subscribe', 'anything', 'challenge-123', res as never);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('POST /whatsapp/webhook — signature verification + dispatch', () => {
    it('processes the payload and returns 200 when no app secret is configured (verification skipped)', async () => {
      const { controller, adapter } = makeController({});
      const res = makeResponse();
      await controller.receive(makeRequest({ entry: [] }), res as never);
      expect(adapter.handleWebhookPayload).toHaveBeenCalledWith({ entry: [] });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('accepts a correctly signed payload when WHATSAPP_APP_SECRET is configured', async () => {
      const { controller, adapter } = makeController({ 'whatsapp.appSecret': 'app-secret-xyz' });
      const res = makeResponse();
      const req = makeRequest({ entry: [] }, 'app-secret-xyz');
      await controller.receive(req, res as never);
      expect(adapter.handleWebhookPayload).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('rejects a payload with an invalid signature when WHATSAPP_APP_SECRET is configured', async () => {
      const { controller, adapter } = makeController({ 'whatsapp.appSecret': 'app-secret-xyz' });
      const res = makeResponse();
      const req = makeRequest({ entry: [] }, 'wrong-secret');
      await controller.receive(req, res as never);
      expect(adapter.handleWebhookPayload).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('still returns 200 even when the adapter throws, so Meta never retries indefinitely', async () => {
      const { controller, adapter } = makeController({});
      (adapter.handleWebhookPayload as jest.Mock).mockRejectedValue(new Error('boom'));
      const res = makeResponse();
      await controller.receive(makeRequest({ entry: [] }), res as never);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Stage 5C.1 — fail-closed production configuration', () => {
    it('refuses to construct when WHATSAPP_PROVIDER_MODE=meta and WHATSAPP_APP_SECRET is missing', () => {
      const config = {
        get: jest.fn(
          (key: string) => (({ 'whatsapp.providerMode': 'meta' }) as Record<string, unknown>)[key],
        ),
      } as unknown as ConfigService;
      const adapter = {} as WhatsAppInboundAdapterService;
      expect(() => new WhatsAppWebhookController(config, adapter)).toThrow(
        WhatsAppConfigurationError,
      );
    });

    it('constructs successfully when WHATSAPP_PROVIDER_MODE=meta and WHATSAPP_APP_SECRET is configured', () => {
      const config = {
        get: jest.fn(
          (key: string) =>
            (
              ({
                'whatsapp.providerMode': 'meta',
                'whatsapp.appSecret': 'app-secret-xyz',
              }) as Record<string, unknown>
            )[key],
        ),
      } as unknown as ConfigService;
      const adapter = {} as WhatsAppInboundAdapterService;
      expect(() => new WhatsAppWebhookController(config, adapter)).not.toThrow();
    });

    it('constructs successfully in local provider mode with no app secret at all — the safe development path', () => {
      const config = {
        get: jest.fn(
          (key: string) => (({ 'whatsapp.providerMode': 'local' }) as Record<string, unknown>)[key],
        ),
      } as unknown as ConfigService;
      const adapter = {} as WhatsAppInboundAdapterService;
      expect(() => new WhatsAppWebhookController(config, adapter)).not.toThrow();
    });

    it('defensively REJECTS (never accepts) an unsigned POST if provider mode somehow reads as meta with no secret at request time, even though construction already passed in local mode', async () => {
      const configValues: Record<string, unknown> = { 'whatsapp.providerMode': 'local' };
      const { controller, adapter } = makeController(configValues);
      // Simulate the mode flipping after boot — construction already succeeded under
      // 'local'; this proves verifySignature itself never blindly trusts that past
      // success, it re-checks live.
      configValues['whatsapp.providerMode'] = 'meta';
      const res = makeResponse();
      await controller.receive(makeRequest({ entry: [] }), res as never);
      expect(adapter.handleWebhookPayload).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
