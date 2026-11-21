// Routing simulation. The outcome is decided ONCE, when the attempt is created,
// and persisted. Nothing downstream re-rolls it.
//
// Normal mode (assessment rules):
//   - ~20% of requests never return a result.
//   - The rest return after a uniformly random delay in [5s, 20s].
//
// Development-only overrides (never honoured when ALLOW_SIMULATION_CONTROLS is off):
//   - 'success'  -> returns after 5s
//   - 'delayed'  -> returns after 20s
//   - 'never'    -> never returns
import { config } from '../config.js';

export type SimulationOverride = 'success' | 'delayed' | 'never';
export type SimulatedOutcome = { outcome: 'returns' | 'never'; delayMs: number | null };

export function decideOutcome(
  override?: SimulationOverride,
  rng: () => number = Math.random,
): SimulatedOutcome {
  const { neverReturnRate, minDelayMs, maxDelayMs } = config.routing;
  if (override === 'never') return { outcome: 'never', delayMs: null };
  if (override === 'success') return { outcome: 'returns', delayMs: minDelayMs };
  if (override === 'delayed') return { outcome: 'returns', delayMs: maxDelayMs };
  if (rng() < neverReturnRate) return { outcome: 'never', delayMs: null };
  const delayMs = Math.round(minDelayMs + rng() * (maxDelayMs - minDelayMs));
  return { outcome: 'returns', delayMs };
}
