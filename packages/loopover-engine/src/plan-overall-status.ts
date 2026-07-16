import type { PlanDag } from "./plan-export.js";
import { nextReadySteps } from "./plan-step-readiness.js";

export type PlanOverallStatus = "pending" | "running" | "completed" | "failed" | "blocked";

/**
 * Resolve the coarse plan status matching hosted `planProgress`'s `status` field. Pure — reads the plan DAG only.
 */
export function resolvePlanOverallStatus(plan: PlanDag): PlanOverallStatus {
  const total = plan.steps.length;
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  const skipped = plan.steps.filter((step) => step.status === "skipped").length;
  const failed = plan.steps.filter((step) => step.status === "failed").length;
  const running = plan.steps.filter((step) => step.status === "running").length;
  const pending = plan.steps.filter((step) => step.status === "pending").length;

  if (total > 0 && completed + skipped === total) return "completed";
  if (failed > 0) return "failed";
  if (running > 0) return "running";
  if (pending > 0 && nextReadySteps(plan).length === 0) return "blocked";
  return "pending";
}
