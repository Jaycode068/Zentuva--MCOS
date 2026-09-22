import { normalizePhoneNumber } from './phone-number-normalizer';

describe('normalizePhoneNumber', () => {
  describe('Nigeria', () => {
    it('normalizes a local-format number (leading 0) to E.164', () => {
      const result = normalizePhoneNumber('08012345678', 'Nigeria');
      expect(result).toEqual({ normalized: '+2348012345678' });
    });

    it('normalizes a number with country code but no + prefix', () => {
      const result = normalizePhoneNumber('2348012345678', 'Nigeria');
      expect(result).toEqual({ normalized: '+2348012345678' });
    });

    it('accepts an already-international +234 number', () => {
      const result = normalizePhoneNumber('+2348012345678', 'Nigeria');
      expect(result).toEqual({ normalized: '+2348012345678' });
    });

    it('strips spaces/dashes/parentheses as cosmetic formatting', () => {
      const result = normalizePhoneNumber('0801 234 5678', 'Nigeria');
      expect(result).toEqual({ normalized: '+2348012345678' });
    });

    it('is case-insensitive and alias-tolerant on the country field ("NG")', () => {
      const result = normalizePhoneNumber('08012345678', 'NG');
      expect(result).toEqual({ normalized: '+2348012345678' });
    });

    it('rejects a local-format number of the wrong length', () => {
      const result = normalizePhoneNumber('080123', 'Nigeria');
      expect(result.normalized).toBeNull();
      expect(result.reason).toMatch(/not in a recognized Nigerian local format/);
    });
  });

  describe('international / already-normalized', () => {
    it('accepts a valid international number regardless of organisation country', () => {
      const result = normalizePhoneNumber('+14155552671', 'United States');
      expect(result).toEqual({ normalized: '+14155552671' });
    });

    it('rejects a + prefixed value that is not a valid E.164 shape', () => {
      const result = normalizePhoneNumber('+1', 'United States');
      expect(result.normalized).toBeNull();
      expect(result.reason).toMatch(/not a valid international format/);
    });
  });

  describe('safe failure — never guess', () => {
    it('refuses a local-format number when the organisation is not Nigeria', () => {
      const result = normalizePhoneNumber('08012345678', 'United States');
      expect(result.normalized).toBeNull();
      expect(result.reason).toMatch(/without a recognized organisation country/);
    });

    it('refuses a local-format number when the organisation country is unknown/empty', () => {
      const result = normalizePhoneNumber('08012345678', null);
      expect(result.normalized).toBeNull();
    });

    it('refuses an empty or missing phone number', () => {
      expect(normalizePhoneNumber('', 'Nigeria').normalized).toBeNull();
      expect(normalizePhoneNumber(null, 'Nigeria').normalized).toBeNull();
      expect(normalizePhoneNumber(undefined, 'Nigeria').normalized).toBeNull();
    });
  });
});
