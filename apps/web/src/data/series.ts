/** Linear-congruential RNG for reproducible series. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return (): number => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a noisy series around a base value. */
export function noisySeries(
  seed: number,
  length: number,
  base: number,
  variance: number,
  trend = 0,
): number[] {
  const rng = mulberry32(seed);
  const out: number[] = new Array(length);
  let value = base;
  for (let i = 0; i < length; i++) {
    value = base + trend * i + (rng() - 0.5) * variance * 2;
    out[i] = Math.max(0, Number(value.toFixed(3)));
  }
  return out;
}

/** A spiky series — most values low but occasional spikes. */
export function spikySeries(seed: number, length: number, base: number, spike: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = new Array(length);
  for (let i = 0; i < length; i++) {
    const r = rng();
    out[i] = r > 0.9 ? base + spike * (0.5 + rng() * 0.5) : base + rng() * (base * 0.3);
  }
  return out;
}

/** Time labels for a given range. */
export function timeLabels(range: '1h' | '24h' | '7d' | '30d' | '90d', length: number): string[] {
  switch (range) {
    case '1h':
      return labelsByMinute(length, 60);
    case '24h':
      return labelsByHour(length);
    case '7d':
      return labelsByDay(length);
    case '30d':
    case '90d':
      return labelsByDay(length);
  }
}

function labelsByMinute(length: number, totalMinutes: number): string[] {
  const out: string[] = [];
  const step = totalMinutes / Math.max(1, length - 1);
  for (let i = 0; i < length; i++) {
    const mAgo = Math.round((length - 1 - i) * step);
    out.push(mAgo === 0 ? 'now' : `${mAgo}m`);
  }
  return out;
}

function labelsByHour(length: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    const h = length - 1 - i;
    out.push(h === 0 ? 'now' : `${h}h`);
  }
  return out;
}

function labelsByDay(length: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    const d = length - 1 - i;
    out.push(d === 0 ? 'today' : `${d}d`);
  }
  return out;
}