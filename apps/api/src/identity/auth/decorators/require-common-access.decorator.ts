import { SetMetadata } from '@nestjs/common';

import { CommonEmployeeAccessPolicy } from '../../authorization/common-access-policy';

export const REQUIRE_COMMON_ACCESS_KEY = 'requireCommonAccess';

/**
 * Declares which `CommonEmployeeAccessPolicy` capability a self-service route requires,
 * checked by {@link CommonAccessGuard} (docs/domains/access-control.md §6). An
 * organisation can disable any of these capabilities for every employee at once — this
 * is checked *in addition to*, never instead of, the caller's own `hr.attendance.self_*`
 * permission grant (still enforced separately, by `@RequirePermission`).
 */
export const RequireCommonAccess = (capability: keyof CommonEmployeeAccessPolicy) =>
  SetMetadata(REQUIRE_COMMON_ACCESS_KEY, capability);
