/**
 * Eases displayed values toward their latest targets so 1 Hz data reads as
 * smooth motion at 30 fps (DESIGN.md §9).
 */
export class Smoother {
  private values = new Map<string, number>();

  /** @param tauS time constant: ~63% of the way to the target after tau seconds. */
  constructor(private readonly tauS = 0.35) {}

  /** Advance `key` toward `target` by dt seconds and return the displayed value. */
  get(key: string, target: number, dtS: number): number {
    const cur = this.values.get(key);
    if (cur === undefined || !Number.isFinite(cur)) {
      this.values.set(key, target);
      return target;
    }
    const next = cur + (target - cur) * (1 - Math.exp(-dtS / this.tauS));
    this.values.set(key, next);
    return next;
  }
}
