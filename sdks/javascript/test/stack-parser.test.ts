import { describe, expect, test } from 'bun:test';
import { parseStack } from '../src/stack-parser';

describe('parseStack — V8 frames', () => {
  test('with function name and file:line:col', () => {
    const stack = `Error: boom
    at processInput (/srv/app/api.ts:42:15)
    at handleRequest (/srv/app/server.ts:10:5)`;
    const frames = parseStack(stack);
    // Reversed to oldest → newest:
    expect(frames.length).toBe(2);
    expect(frames[0]?.function).toBe('handleRequest');
    expect(frames[0]?.abs_path).toBe('/srv/app/server.ts');
    expect(frames[0]?.lineno).toBe(10);
    expect(frames[0]?.colno).toBe(5);
    expect(frames[1]?.function).toBe('processInput');
    expect(frames[1]?.lineno).toBe(42);
  });

  test('without function name (anonymous file:line:col)', () => {
    const stack = `Error: x
    at /srv/app/index.ts:1:1`;
    const frames = parseStack(stack);
    expect(frames.length).toBe(1);
    expect(frames[0]?.function).toBeUndefined();
    expect(frames[0]?.abs_path).toBe('/srv/app/index.ts');
    expect(frames[0]?.lineno).toBe(1);
    expect(frames[0]?.colno).toBe(1);
  });

  test('anonymous function is normalised to no function name', () => {
    const stack = `Error: x
    at <anonymous> (/srv/app/index.ts:5:7)`;
    const frames = parseStack(stack);
    expect(frames[0]?.function).toBeUndefined();
  });

  test('native frames', () => {
    const stack = `Error: x
    at Array.forEach (native)`;
    const frames = parseStack(stack);
    expect(frames.length).toBe(1);
    expect(frames[0]?.function).toBe('Array.forEach');
    expect(frames[0]?.abs_path).toBe('[native]');
  });

  test('empty / no-stack', () => {
    expect(parseStack('')).toEqual([]);
    expect(parseStack(undefined as unknown as string)).toEqual([]);
  });

  test('skips message line and blanks', () => {
    const stack = `Error: oh no\n\n    at fn (a.ts:1:1)\n\n`;
    const frames = parseStack(stack);
    expect(frames.length).toBe(1);
    expect(frames[0]?.function).toBe('fn');
  });

  test('mixed frame forms', () => {
    const stack = `Error: mix
    at outer (/a.ts:1:1)
    at /b.ts:2:2
    at <anonymous> (/c.ts:3:3)`;
    const frames = parseStack(stack);
    // Reversed: c, b, a
    expect(frames.length).toBe(3);
    expect(frames[0]?.abs_path).toBe('/c.ts');
    expect(frames[1]?.abs_path).toBe('/b.ts');
    expect(frames[2]?.abs_path).toBe('/a.ts');
  });
});
