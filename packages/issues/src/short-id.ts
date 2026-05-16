/**
 * Short ID generator.
 *
 * Sentry's `<PROJECT_SLUG>-<N>` form is the human-facing handle
 * for a group. We accept a project slug at construction time
 * (uppercased) and emit successive integers for each newly
 * created group within that project.
 *
 * The counter is monotone but not gap-free across restarts: the
 * issue store loads existing groups on boot and seeds the counter
 * past the highest observed value. The counter never decreases.
 */

export class ShortIdGenerator {
  private counter: number;
  constructor(
    public readonly slug: string,
    startAt = 0,
  ) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(slug)) {
      throw new RangeError(
        `ShortIdGenerator: slug "${slug}" must match /^[A-Za-z][A-Za-z0-9_-]{0,31}$/`,
      );
    }
    if (!Number.isInteger(startAt) || startAt < 0) {
      throw new RangeError(`ShortIdGenerator: startAt must be a non-negative integer`);
    }
    this.counter = startAt;
  }
  next(): string {
    this.counter += 1;
    return `${this.slug.toUpperCase()}-${this.counter}`;
  }
  /** Advance the counter past `n` if it isn't already. Used during boot-time seeding. */
  seed(n: number): void {
    if (n > this.counter) this.counter = n;
  }
  get current(): number {
    return this.counter;
  }
}
