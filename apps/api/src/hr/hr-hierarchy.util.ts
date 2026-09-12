/**
 * Shared self-referencing-hierarchy cycle guard, used independently by
 * Department (`parentDepartmentId`), Position (`reportsToPositionId`), and
 * Employee (`managerEmployeeId`) — three separate trees, same rule: walking
 * up from the proposed new parent must never reach the node being moved.
 * A depth cap prevents an unbounded loop if data is ever corrupt.
 */
const MAX_HIERARCHY_DEPTH = 100;

export async function wouldCreateCycle(
  getParentId: (id: string) => Promise<string | null>,
  nodeId: string,
  proposedParentId: string,
): Promise<boolean> {
  if (nodeId === proposedParentId) {
    return true;
  }

  let currentId: string | null = proposedParentId;
  let depth = 0;
  while (currentId && depth < MAX_HIERARCHY_DEPTH) {
    if (currentId === nodeId) {
      return true;
    }
    currentId = await getParentId(currentId);
    depth += 1;
  }
  return false;
}
