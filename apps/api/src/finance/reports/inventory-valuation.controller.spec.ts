import { TokenPayload } from '../../identity/auth/ports/token.port';
import { InventoryValuationController } from './inventory-valuation.controller';
import { InventoryValuationService } from './inventory-valuation.service';

describe('InventoryValuationController', () => {
  function makeController() {
    const inventoryValuationService = {
      getValuation: jest.fn().mockResolvedValue({ lines: [], totals: { grandTotal: 0 } }),
    } as unknown as jest.Mocked<InventoryValuationService>;
    return {
      controller: new InventoryValuationController(inventoryValuationService),
      inventoryValuationService,
    };
  }

  it('scopes to the caller organisation and forwards locationId/productType filters', async () => {
    const { controller, inventoryValuationService } = makeController();
    const user: TokenPayload = { sub: 'user-1', organisationId: 'org-1', sessionId: 's-1' };

    await controller.getInventoryValuation(user, 'loc-1', 'RAW_MATERIAL' as never);

    expect(inventoryValuationService.getValuation).toHaveBeenCalledWith('org-1', {
      locationId: 'loc-1',
      productType: 'RAW_MATERIAL',
    });
  });

  it('tenant isolation: a different caller organisation is passed through unchanged', async () => {
    const { controller, inventoryValuationService } = makeController();
    const user: TokenPayload = { sub: 'user-2', organisationId: 'org-2', sessionId: 's-2' };

    await controller.getInventoryValuation(user);

    expect(inventoryValuationService.getValuation).toHaveBeenCalledWith(
      'org-2',
      expect.any(Object),
    );
  });
});
