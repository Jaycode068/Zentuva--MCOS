import { BadRequestException } from '@nestjs/common';

/**
 * Shared self-referencing-hierarchy cycle guard, reused across
 * `AssetCategory`/`AssetLocation`/`Asset` (all three carry an optional
 * `parent...Id` self-relation) — one small helper within this one domain,
 * not a cross-domain abstraction. Walks up from the *proposed* parent; if
 * the walk ever reaches `candidateId` itself, `candidateId` is an ancestor
 * of the proposed parent, so assigning it would create a cycle.
 */
export async function assertNoHierarchyCycle(
  entityLabel: string,
  candidateId: string,
  parentId: string | null | undefined,
  getParentId: (id: string) => Promise<string | null | undefined>,
): Promise<void> {
  if (!parentId) {
    return;
  }
  if (parentId === candidateId) {
    throw new BadRequestException(`A ${entityLabel} cannot be its own parent`);
  }
  const visited = new Set<string>();
  let current: string | null | undefined = parentId;
  while (current) {
    if (current === candidateId) {
      throw new BadRequestException(`This would create a circular ${entityLabel} hierarchy`);
    }
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    current = await getParentId(current);
  }
}
