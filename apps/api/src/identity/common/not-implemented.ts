/**
 * Marks a service method as a Sprint 1B.1 skeleton: the signature exists (per
 * docs/domains/identity.md's API contract, §10) but the body is deferred to a later
 * sprint because it requires authentication logic, permission evaluation, or another
 * capability explicitly out of scope for the Database & Domain Layer sprint. See
 * docs/sprint-1B.1-completion-report.md.
 */
export function notImplemented(method: string): Promise<never> {
  return Promise.reject(
    new Error(`${method} is not implemented in Sprint 1B.1 (Database & Domain Layer only).`),
  );
}
