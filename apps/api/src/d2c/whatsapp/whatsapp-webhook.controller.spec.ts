import { createHmac } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { WhatsAppInboundAdapterService } from './whatsapp-inbound-adapter.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

describe('WhatsAppWebhookController', () => {
  function makeResponse() {
    return { status: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() };
  }

  function makeController(configValues: Record<string, unknown>) {
    const config = { get: jest.fn((key: string) => configValues[key]) } as unknown as ConfigService;
    const adapter = {
      handleWebhookPayload: jest.fn().mockResolvedValue(undefined),
    } as unknown as WhatsAppInboundAdapterService;
    return { controller: new WhatsAppWebhookController(config, adapter), adapter };
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
    function makeRequest(body: unknown, appSecret?: string) {
      const rawBody = Buffer.from(JSON.stringify(body));
      const headers: Record<string, string> = {};
      if (appSecret) {
        const signature = createHmac('sha256', appSecret).update(rawBody).digest('hex');
        headers['x-hub-signature-256'] = `sha256=${signature}`;
      }
      return { rawBody, body, headers } as never;
    }

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
});
