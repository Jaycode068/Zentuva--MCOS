/**
 * Sprint 29 §12 "Phone Number Handling." `User.phoneNumber` (identity.ts) has
 * no format validation beyond "optional string" — Sprint 3.3's own documented
 * choice. This is the ONE place in the WhatsApp delivery pipeline that turns
 * that free-form string into an internationally normalized (E.164-shaped,
 * `+<countrycode><number>`) representation the WhatsApp Business Platform
 * actually requires, or explicitly refuses to guess.
 *
 * Deliberately narrow: this codebase's only seeded/live tenant data uses
 * Nigerian numbers, so the Nigeria-specific local-format rule below is the
 * only "smart" normalization implemented. For any organisation whose
 * `Organisation.country` is not (a recognized spelling of) Nigeria, a number
 * is accepted ONLY if it is already unambiguously international (starts with
 * `+` and looks like a valid E.164 number) — never silently assumed to be
 * Nigerian, and never silently assumed to be anything else. "Fail safely
 * rather than send to an ambiguous number" (brief §12) — an unnormalizable
 * number makes the notification WhatsApp-ineligible (see
 * `WhatsAppEligibilityService`), never a best-guess send.
 */

const NIGERIA_COUNTRY_ALIASES = new Set(['nigeria', 'ng', 'nga']);

export interface PhoneNormalizationResult {
  normalized: string | null;
  reason?: string;
}

function isNigeriaCountry(country: string | null | undefined): boolean {
  if (!country) return false;
  return NIGERIA_COUNTRY_ALIASES.has(country.trim().toLowerCase());
}

/** Strips everything except leading `+` and digits — spaces, dashes,
 *  parentheses are all cosmetic and never meaningful for this purpose. */
function stripFormatting(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/[^0-9]/g, '');
}

/** A conservative E.164 shape check — `+` followed by 8 to 15 digits (the
 *  ITU E.164 maximum). Deliberately does not validate that the country code
 *  itself is real; this codebase is not a phone-number-validation library,
 *  only a "does this look unambiguously international" gate. */
function looksLikeE164(value: string): boolean {
  return /^\+[1-9][0-9]{7,14}$/.test(value);
}

export function normalizePhoneNumber(
  rawPhoneNumber: string | null | undefined,
  organisationCountry: string | null | undefined,
): PhoneNormalizationResult {
  if (!rawPhoneNumber || !rawPhoneNumber.trim()) {
    return { normalized: null, reason: 'No phone number on file' };
  }

  const stripped = stripFormatting(rawPhoneNumber);

  // Already unambiguously international — accepted regardless of
  // organisation country, since a `+`-prefixed number carries its own
  // country code and needs no guessing.
  if (stripped.startsWith('+')) {
    return looksLikeE164(stripped)
      ? { normalized: stripped }
      : { normalized: null, reason: 'Phone number is not a valid international format' };
  }

  if (isNigeriaCountry(organisationCountry)) {
    // Nigeria-specific local-format rule (brief §12's own worked examples):
    //   08012345678   → local format, leading trunk-prefix 0  → +234 801 234 5678
    //   2348012345678 → country code present, no leading +    → +234 801 234 5678
    //   +2348012345678 already handled by the branch above.
    if (stripped.startsWith('234') && stripped.length === 13) {
      const candidate = `+${stripped}`;
      return looksLikeE164(candidate)
        ? { normalized: candidate }
        : { normalized: null, reason: 'Phone number is not a valid Nigerian number' };
    }
    if (stripped.startsWith('0') && stripped.length === 11) {
      const candidate = `+234${stripped.slice(1)}`;
      return looksLikeE164(candidate)
        ? { normalized: candidate }
        : { normalized: null, reason: 'Phone number is not a valid Nigerian number' };
    }
    return {
      normalized: null,
      reason: 'Phone number is not in a recognized Nigerian local format (expected 0XXXXXXXXXX)',
    };
  }

  // Not Nigeria, and not already international — this codebase has no
  // reliable country-specific local-format rule for any other country, so
  // it refuses to guess rather than risk sending to the wrong number/country.
  return {
    normalized: null,
    reason:
      'Cannot normalize a local-format phone number without a recognized organisation country — provide an international format (starting with +) instead',
  };
}
