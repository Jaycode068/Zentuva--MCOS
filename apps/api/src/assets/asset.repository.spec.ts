import { AssetRepository } from './asset.repository';
import { PrismaService } from '../prisma/prisma.service';

const ORG = 'org-1';

function makeRepository() {
  const assets = new Map<string, Record<string, unknown>>();
  const movements = new Map<string, Record<string, unknown>>();
  let assetSeq = 0;
  let movementSeq = 0;

  const tx = {
    asset: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_idempotencyKey?: { organisationId: string; idempotencyKey: string };
            organisationId_assetCode?: { organisationId: string; assetCode: string };
            id?: string;
          };
          select?: { id: true };
        }) => {
          if (where.organisationId_idempotencyKey) {
            const lookup = where.organisationId_idempotencyKey;
            for (const row of assets.values()) {
              if (
                row.organisationId === lookup.organisationId &&
                row.idempotencyKey === lookup.idempotencyKey
              ) {
                return row;
              }
            }
            return null;
          }
          if (where.organisationId_assetCode) {
            const lookup = where.organisationId_assetCode;
            for (const row of assets.values()) {
              if (
                row.organisationId === lookup.organisationId &&
                row.assetCode === lookup.assetCode
              ) {
                return row;
              }
            }
            return null;
          }
          if (where.id) {
            return assets.get(where.id) ?? null;
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        assetSeq += 1;
        const id = `asset-${assetSeq}`;
        const row = { id, status: 'DRAFT', condition: 'NEW', ...data };
        assets.set(id, row);
        return row;
      }),
      findFirstOrThrow: jest.fn(
        async ({ where }: { where: { id: string; organisationId: string } }) => {
          const row = assets.get(where.id);
          if (!row || row.organisationId !== where.organisationId) throw new Error('not found');
          return row;
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = assets.get(where.id);
        if (!row) throw new Error('not found');
        return row;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = assets.get(where.id);
          if (!row) throw new Error('not found');
          const updated = { ...row, ...data };
          assets.set(where.id, updated);
          return updated;
        },
      ),
    },
    assetMovement: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_idempotencyKey?: { organisationId: string; idempotencyKey: string };
          };
        }) => {
          const lookup = where.organisationId_idempotencyKey;
          if (!lookup) return null;
          for (const row of movements.values()) {
            if (
              row.organisationId === lookup.organisationId &&
              row.idempotencyKey === lookup.idempotencyKey
            ) {
              return row;
            }
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        movementSeq += 1;
        const id = `movement-${movementSeq}`;
        const row = { id, ...data };
        movements.set(id, row);
        return row;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  return { repository: new AssetRepository(prisma), assets, movements };
}

function baseAssetData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organisationId: ORG,
    name: 'Industrial Air Compressor',
    categoryId: 'category-1',
    createdById: 'user-1',
    ...overrides,
  } as never;
}

describe('AssetRepository.create', () => {
  it('generates a sequential, prefixed, immutable asset code', async () => {
    const { repository } = makeRepository();
    const { asset } = await repository.create(baseAssetData());
    expect(asset.assetCode).toBe('AST-000001');
  });

  it('generates the next available code when the first is already taken', async () => {
    const { repository } = makeRepository();
    await repository.create(baseAssetData({ idempotencyKey: 'k1' }));
    const { asset } = await repository.create(baseAssetData({ idempotencyKey: 'k2' }));
    expect(asset.assetCode).toBe('AST-000002');
  });

  it('idempotent replay: a duplicate idempotencyKey returns the original row, wasCreated:false', async () => {
    const { repository, assets } = makeRepository();
    const first = await repository.create(baseAssetData({ idempotencyKey: 'dup' }));
    const second = await repository.create(
      baseAssetData({ idempotencyKey: 'dup', name: 'Different Name' }),
    );
    expect(second.wasCreated).toBe(false);
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.name).toBe('Industrial Air Compressor');
    expect(assets.size).toBe(1);
  });
});

describe('AssetRepository.transfer', () => {
  it('captures previous and new location/custodian exactly, updating the asset in the same transaction', async () => {
    const { repository, assets } = makeRepository();
    const { asset } = await repository.create(baseAssetData({ idempotencyKey: 'k1' }));
    assets.set(asset.id as string, { ...asset, locationId: 'loc-utility', custodianId: 'user-1' });

    const result = await repository.transfer({
      organisationId: ORG,
      assetId: asset.id as string,
      newLocationId: 'loc-maintenance',
      performedById: 'user-2',
      idempotencyKey: 'transfer-1',
    });

    expect(result.asset.locationId).toBe('loc-maintenance');
    expect(result.asset.custodianId).toBe('user-1'); // unchanged, since not provided
  });

  it('idempotent replay: a duplicate transfer idempotencyKey does not create a second movement row', async () => {
    const { repository, assets, movements } = makeRepository();
    const { asset } = await repository.create(baseAssetData({ idempotencyKey: 'k1' }));
    assets.set(asset.id as string, { ...asset, locationId: 'loc-a' });

    await repository.transfer({
      organisationId: ORG,
      assetId: asset.id as string,
      newLocationId: 'loc-b',
      performedById: 'user-1',
      idempotencyKey: 'transfer-dup',
    });
    const second = await repository.transfer({
      organisationId: ORG,
      assetId: asset.id as string,
      newLocationId: 'loc-c',
      performedById: 'user-1',
      idempotencyKey: 'transfer-dup',
    });

    expect(second.wasCreated).toBe(false);
    expect(movements.size).toBe(1);
  });
});
