import { beforeEach, describe, expect, it } from "vitest";
import { counterValue, incr, observe, renderMetrics, resetMetrics } from "../../../packages/discovery-index/src/metrics";

describe("discovery-index metrics (#7164)", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("increments a counter and reads it back, defaulting unseen series to 0", () => {
    expect(counterValue("discovery_index_query_requests_total", { status: "ok" })).toBe(0);
    incr("discovery_index_query_requests_total", { status: "ok" });
    incr("discovery_index_query_requests_total", { status: "ok" }, 2);
    expect(counterValue("discovery_index_query_requests_total", { status: "ok" })).toBe(3);
  });

  it("renders HELP/TYPE metadata for a known metric and emits it once per series", () => {
    incr("discovery_index_query_requests_total", { status: "ok" });
    const rendered = renderMetrics();
    expect(rendered).toContain("# HELP discovery_index_query_requests_total");
    expect(rendered).toContain("# TYPE discovery_index_query_requests_total counter");
    expect(rendered).toContain('discovery_index_query_requests_total{status="ok"} 1');
  });

  it("sorts multiple label keys deterministically regardless of insertion order", () => {
    incr("discovery_index_query_requests_total", { status: "ok", route: "query" });
    const rendered = renderMetrics();
    expect(rendered).toContain('discovery_index_query_requests_total{route="query",status="ok"} 1');
  });

  it("emits HELP/TYPE metadata only once for a metric with multiple label-value series", () => {
    incr("discovery_index_query_requests_total", { status: "ok" });
    incr("discovery_index_query_requests_total", { status: "unauthorized" });
    const rendered = renderMetrics();
    expect(rendered.match(/# HELP discovery_index_query_requests_total/g)).toHaveLength(1);
    expect(rendered).toContain('discovery_index_query_requests_total{status="ok"} 1');
    expect(rendered).toContain('discovery_index_query_requests_total{status="unauthorized"} 1');
  });

  it("renders an ad-hoc metric with no registered metadata as a bare series line", () => {
    incr("some_unregistered_counter");
    const rendered = renderMetrics();
    expect(rendered).not.toContain("# HELP some_unregistered_counter");
    expect(rendered).toContain("some_unregistered_counter 1");
  });

  it("observes histogram values into cumulative buckets including +Inf, sum, and count", () => {
    observe("discovery_index_query_request_duration_seconds", 0.02);
    observe("discovery_index_query_request_duration_seconds", 3);
    const rendered = renderMetrics();
    expect(rendered).toContain('discovery_index_query_request_duration_seconds_bucket{le="0.025"} 1');
    expect(rendered).toContain('discovery_index_query_request_duration_seconds_bucket{le="+Inf"} 2');
    expect(rendered).toContain("discovery_index_query_request_duration_seconds_sum 3.02");
    expect(rendered).toContain("discovery_index_query_request_duration_seconds_count 2");
  });

  it("resetMetrics clears all series", () => {
    incr("discovery_index_query_requests_total", { status: "ok" });
    resetMetrics();
    expect(counterValue("discovery_index_query_requests_total", { status: "ok" })).toBe(0);
    expect(renderMetrics()).toBe("\n");
  });
});
