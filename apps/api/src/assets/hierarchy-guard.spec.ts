import { BadRequestException } from '@nestjs/common';

import { assertNoHierarchyCycle } from './hierarchy-guard';

describe('assertNoHierarchyCycle', () => {
  it('allows a null/undefined parent (no hierarchy assignment at all)', async () => {
    await expect(
      assertNoHierarchyCycle('asset', 'a', undefined, async () => null),
    ).resolves.toBeUndefined();
  });

  it('rejects an entity being assigned as its own parent', async () => {
    await expect(assertNoHierarchyCycle('asset', 'a', 'a', async () => null)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('allows a simple, non-circular two-level assignment', async () => {
    // b's own parent is null — assigning a's parent to b is fine.
    await expect(
      assertNoHierarchyCycle('asset', 'a', 'b', async (id) => (id === 'b' ? null : undefined)),
    ).resolves.toBeUndefined();
  });

  it('rejects a direct circular assignment (a -> b, then attempting b -> a)', async () => {
    // Walking up from 'a' (the proposed parent of 'b') immediately reaches 'b' itself.
    const getParentId = async (id: string) => (id === 'a' ? 'b' : null);
    await expect(assertNoHierarchyCycle('asset', 'b', 'a', getParentId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a deeper circular assignment (a -> b -> c, then attempting c -> a)', async () => {
    const parents: Record<string, string | null> = { a: null, b: 'a', c: 'b' };
    const getParentId = async (id: string) => parents[id] ?? null;
    // Proposing c's parent = a: walking up from 'a' reaches null (a has no parent) —
    // this alone is fine. The real cycle case is proposing a's parent = c: walking up
    // from 'c' reaches 'b' then 'a' — the candidate — a cycle.
    await expect(assertNoHierarchyCycle('asset', 'a', 'c', getParentId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('allows attaching a deep, unrelated chain', async () => {
    const parents: Record<string, string | null> = { x: null, y: 'x', z: 'y' };
    const getParentId = async (id: string) => parents[id] ?? null;
    await expect(assertNoHierarchyCycle('asset', 'a', 'z', getParentId)).resolves.toBeUndefined();
  });
});
