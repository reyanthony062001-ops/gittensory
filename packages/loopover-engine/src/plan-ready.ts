import type { PlanDag } from "./plan-export.js";
import { nextReadySteps } from "./plan-step-readiness.js";

/**
 * Return whether any step is runnable now: `pending` with every dependency `completed` or `skipped`. Mirrors hosted
 * `nextReadySteps(plan).length > 0`. Pure.
 */
export function hasPlanReadySteps(plan: PlanDag): boolean {
  return nextReadySteps(plan).length > 0;
}
