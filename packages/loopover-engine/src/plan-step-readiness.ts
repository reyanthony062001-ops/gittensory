import type { PlanDag, PlanStep, PlanStepStatus } from "./plan-export.js";

export function isDone(status: PlanStepStatus): boolean {
  return status === "completed" || status === "skipped";
}

export function nextReadySteps(plan: PlanDag): PlanStep[] {
  const statusById = new Map(plan.steps.map((step) => [step.id, step.status]));
  return plan.steps.filter(
    (step) => step.status === "pending" && step.dependsOn.every((dep) => isDone(statusById.get(dep) ?? "pending")),
  );
}
