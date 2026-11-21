import { describe, expect, it } from 'vitest';
import { decideOutcome } from '../src/services/simulation.js';

describe('routing simulation outcome', () => {
  it('never-returns when the roll falls below the 20% threshold', () => {
    expect(decideOutcome(undefined, () => 0.1)).toEqual({ outcome: 'never', delayMs: null });
  });

  it('returns with a delay between 5s and 20s otherwise', () => {
    expect(decideOutcome(undefined, () => 0.5)).toEqual({ outcome: 'returns', delayMs: 12_500 });
    expect(decideOutcome(undefined, () => 0.2)).toEqual({ outcome: 'returns', delayMs: 8_000 });
    const low = decideOutcome(undefined, () => 0.2 + 1e-9);
    const high = decideOutcome(undefined, () => 0.999999);
    expect(low.delayMs!).toBeGreaterThanOrEqual(5_000);
    expect(high.delayMs!).toBeLessThanOrEqual(20_000);
  });

  it('is approximately 20% never-returning over many samples', () => {
    let never = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) if (decideOutcome().outcome === 'never') never++;
    const rate = never / n;
    expect(rate).toBeGreaterThan(0.18);
    expect(rate).toBeLessThan(0.22);
  });

  it('honours development overrides deterministically', () => {
    expect(decideOutcome('never')).toEqual({ outcome: 'never', delayMs: null });
    expect(decideOutcome('success')).toEqual({ outcome: 'returns', delayMs: 5_000 });
    expect(decideOutcome('delayed')).toEqual({ outcome: 'returns', delayMs: 20_000 });
  });
});
