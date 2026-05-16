import { describe, expect, test } from 'bun:test';
import { isLuhnValid } from '../src/luhn';

describe('isLuhnValid — valid test PANs', () => {
  // Canonical test card numbers from common payment processors.
  const valid = [
    '4111111111111111', // Visa
    '5555555555554444', // MasterCard
    '378282246310005', // Amex (15 digits)
    '6011111111111117', // Discover
    '3530111333300000', // JCB
    '4242424242424242', // Stripe test
  ];
  for (const pan of valid) {
    test(pan, () => {
      expect(isLuhnValid(pan)).toBe(true);
    });
  }
});

describe('isLuhnValid — invalid', () => {
  test('one-off-by-one digit fails Luhn', () => {
    expect(isLuhnValid('4111111111111112')).toBe(false);
  });

  test('too short', () => {
    expect(isLuhnValid('411111111')).toBe(false);
  });

  test('too long', () => {
    expect(isLuhnValid('41111111111111111111')).toBe(false);
  });

  test('empty', () => {
    expect(isLuhnValid('')).toBe(false);
  });
});

describe('isLuhnValid — non-digit handling', () => {
  test('spaces are stripped', () => {
    expect(isLuhnValid('4111 1111 1111 1111')).toBe(true);
  });

  test('dashes are stripped', () => {
    expect(isLuhnValid('4111-1111-1111-1111')).toBe(true);
  });

  test('mixed punctuation', () => {
    expect(isLuhnValid('4111-1111 1111-1111')).toBe(true);
  });
});
