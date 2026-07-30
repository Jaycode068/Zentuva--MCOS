/**
 * Password hashing, behind an interface (Sprint 1B.2 brief): the rest of the app never
 * calls bcrypt directly, only this port. Swapping to Argon2 later is a new adapter, not a
 * rewrite of UserService/AuthService.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  compare(plaintext: string, hash: string): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
