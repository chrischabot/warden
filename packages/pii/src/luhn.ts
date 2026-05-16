/**
 * Luhn check digit validation.
 *
 * Returns true if the digit sequence's Luhn sum modulo 10 is zero.
 * Non-digit characters in the input are stripped first; if the
 * result has fewer than 13 or more than 19 digits, returns false
 * (real PANs are 13–19 digits).
 */

export function isLuhnValid(digits: string): boolean {
  let stripped = '';
  for (let i = 0; i < digits.length; i++) {
    const c = digits.charCodeAt(i);
    if (c >= 0x30 && c <= 0x39) {
      stripped += digits[i] as string;
    }
  }
  if (stripped.length < 13 || stripped.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = stripped.length - 1; i >= 0; i--) {
    let n = stripped.charCodeAt(i) - 0x30;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
