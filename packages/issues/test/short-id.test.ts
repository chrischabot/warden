import { describe, expect, test } from 'bun:test';
import { ShortIdGenerator } from '../src/short-id';

describe('ShortIdGenerator', () => {
  test('emits monotone PROJ-N', () => {
    const g = new ShortIdGenerator('proj');
    expect(g.next()).toBe('PROJ-1');
    expect(g.next()).toBe('PROJ-2');
    expect(g.next()).toBe('PROJ-3');
  });

  test('uppercases the slug', () => {
    expect(new ShortIdGenerator('mixedCase').next()).toBe('MIXEDCASE-1');
  });

  test('seed advances past explicit n', () => {
    const g = new ShortIdGenerator('s');
    g.seed(100);
    expect(g.next()).toBe('S-101');
  });

  test('seed cannot go backwards', () => {
    const g = new ShortIdGenerator('s');
    g.seed(100);
    g.seed(50);
    expect(g.next()).toBe('S-101');
  });

  test('rejects invalid slug shapes', () => {
    expect(() => new ShortIdGenerator('')).toThrow(RangeError);
    expect(() => new ShortIdGenerator('1bad')).toThrow(RangeError);
    expect(() => new ShortIdGenerator('has space')).toThrow(RangeError);
    expect(() => new ShortIdGenerator('a'.repeat(33))).toThrow(RangeError);
  });

  test('current reflects last emitted', () => {
    const g = new ShortIdGenerator('p');
    g.next();
    g.next();
    expect(g.current).toBe(2);
  });
});
