/**
 * Hash helpers for approximate data structures.
 *
 * Backed by `Bun.hash` (wyhash, 64-bit BigInt output). Deterministic
 * and seed-dependent. We expose 64-bit BigInt and 32-bit number
 * variants so each consumer can pick the cheapest form.
 */

type Hashable = string | Uint8Array | ArrayBuffer | ArrayBufferView;

/** 64-bit hash as a BigInt. Seed selects an independent hash function. */
export function hash64(input: Hashable, seed = 0): bigint {
  // Bun.hash's overloads accept `string | NodeJS.TypedArray | ArrayBuffer
  // | DataView | Blob | Bun.BunFile`. Uint8Array and ArrayBuffer both
  // satisfy that, but TypeScript's narrower public types occasionally
  // disagree; a localised cast is acceptable here because the runtime
  // behaviour is well-defined.
  return (Bun.hash as (data: Hashable, seed?: number) => bigint)(input, seed);
}

/** 32-bit hash; the low 32 bits of `hash64`, returned as an unsigned number. */
export function hash32(input: Hashable, seed = 0): number {
  return Number(hash64(input, seed) & 0xffffffffn) >>> 0;
}
