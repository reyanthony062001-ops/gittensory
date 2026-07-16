import { describe, expect, it } from "vitest";

import { isDone, nextReadySteps } from "../../packages/loopover-engine/src/plan-step-readiness";
import type { PlanStep, PlanStepStatus } from "../../packages/loopover-engine/src/plan-export";

function step(over: Partial<PlanStep> & { id: string; title: string }): PlanStep {
  return {
    actionClass: undefined,
    dependsOn: [],
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    ...over,
  };
}

describe("isDone", () => {
  it.each<PlanStepStatus>(["pending", "running", "failed"])("returns false for %s", (status) => {
    expect(isDone(status)).toBe(false);
  });

  it.each<PlanStepStatus>(["completed", "skipped"])("returns true for %s", (status) => {
    expect(isDone(status)).toBe(true);
  });
});

describe("nextReadySteps", () => {
  it("returns a pending step with no dependencies", () => {
    const ready = step({ id: "a", title: "Build", status: "pending" });
    expect(nextReadySteps({ steps: [ready] })).toEqual([ready]);
  });

  it("returns a pending step when its dependency is completed", () => {
    const dep = step({ id: "a", title: "Build", status: "completed" });
    const ready = step({ id: "b", title: "Test", status: "pending", dependsOn: ["a"] });
    expect(nextReadySteps({ steps: [dep, ready] })).toEqual([ready]);
  });

  it("returns a pending step when its dependency is skipped", () => {
    const dep = step({ id: "a", title: "Build", status: "skipped" });
    const ready = step({ id: "b", title: "Test", status: "pending", dependsOn: ["a"] });
    expect(nextReadySteps({ steps: [dep, ready] })).toEqual([ready]);
  });

  it.each<PlanStepStatus>(["running", "failed"])("returns no ready steps when a dependency is %s", (status) => {
    const dep = step({ id: "a", title: "Build", status });
    const blocked = step({ id: "b", title: "Test", status: "pending", dependsOn: ["a"] });
    expect(nextReadySteps({ steps: [dep, blocked] })).toEqual([]);
  });

  it("returns no ready steps when a dependency is still pending", () => {
    const dep = step({ id: "a", title: "Build", status: "pending", dependsOn: ["ghost"] });
    const blocked = step({ id: "b", title: "Test", status: "pending", dependsOn: ["a"] });
    expect(nextReadySteps({ steps: [dep, blocked] })).toEqual([]);
  });
});
