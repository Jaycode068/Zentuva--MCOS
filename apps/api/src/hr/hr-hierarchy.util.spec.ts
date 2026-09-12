import { wouldCreateCycle } from './hr-hierarchy.util';

describe('wouldCreateCycle', () => {
  it('rejects a self-reference (node cannot be its own parent)', async () => {
    const getParentId = jest.fn(async () => null);
    const result = await wouldCreateCycle(getParentId, 'a', 'a');
    expect(result).toBe(true);
    expect(getParentId).not.toHaveBeenCalled();
  });

  it('detects a two-node cycle (a -> b -> a)', async () => {
    const parents: Record<string, string | null> = { b: 'a' };
    const getParentId = jest.fn(async (id: string) => parents[id] ?? null);
    // Assigning a's parent to b, where b's parent is already a.
    const result = await wouldCreateCycle(getParentId, 'a', 'b');
    expect(result).toBe(true);
  });

  it('detects a deeper cycle (a -> c -> b -> a)', async () => {
    const parents: Record<string, string | null> = { c: 'b', b: 'a' };
    const getParentId = jest.fn(async (id: string) => parents[id] ?? null);
    const result = await wouldCreateCycle(getParentId, 'a', 'c');
    expect(result).toBe(true);
  });

  it('allows a valid, non-circular assignment', async () => {
    const parents: Record<string, string | null> = { b: null };
    const getParentId = jest.fn(async (id: string) => parents[id] ?? null);
    const result = await wouldCreateCycle(getParentId, 'a', 'b');
    expect(result).toBe(false);
  });

  it('allows reassignment to an unrelated existing node', async () => {
    const parents: Record<string, string | null> = { x: null, y: 'x' };
    const getParentId = jest.fn(async (id: string) => parents[id] ?? null);
    const result = await wouldCreateCycle(getParentId, 'a', 'y');
    expect(result).toBe(false);
  });
});
