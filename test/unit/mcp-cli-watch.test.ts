import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeFixtureServer, runAsync, runExpectingFailure, startFixtureServer } from "./support/mcp-cli-harness";

// #6746: the `loopover-mcp watch <list|add|remove>` CLI, mirroring the loopover_watch_issues MCP tool and the
// /v1/contributors/:login/watches routes. list=GET, add=POST, remove=DELETE.
describe("loopover-mcp CLI — watch (#6746)", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    await closeFixtureServer();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  async function env(options: Parameters<typeof startFixtureServer>[0] = {}) {
    tempDir = mkdtempSync(join(tmpdir(), "loopover-cli-"));
    const url = await startFixtureServer(options);
    return { LOOPOVER_API_URL: url, LOOPOVER_TOKEN: "session-token", LOOPOVER_CONFIG_DIR: tempDir, LOOPOVER_API_TIMEOUT_MS: "1000" };
  }

  it("list shows the watched repos (plain + json), hitting GET", async () => {
    const requests: string[] = [];
    const e = await env({ onApiRequest: (r) => requests.push(`${r.method} ${r.url}`) });
    const plain = await runAsync(["watch", "list", "--login", "octocat"], e);
    expect(plain).toMatch(/Watching 2 repo\(s\) for octocat\./);
    expect(plain).toMatch(/- acme\/widgets \[bug\]/);
    expect(plain).toMatch(/- acme\/gadgets/);
    expect(requests.at(-1)).toBe("GET /v1/contributors/octocat/watches");
    const json = JSON.parse(await runAsync(["watch", "list", "--login", "octocat", "--json"], e)) as { watching: unknown[] };
    expect(json.watching).toHaveLength(2);
  });

  it("add POSTs {repoFullName,labels} and reports the change", async () => {
    const seen: Array<{ method: string; body: { repoFullName?: string; labels?: string[] } }> = [];
    const e = await env({ onWatchRequest: (req) => seen.push(req) });
    const out = await runAsync(["watch", "add", "acme/widgets", "--labels", "bug,feature", "--login", "octocat"], e);
    expect(seen[0]).toEqual({ method: "POST", body: { repoFullName: "acme/widgets", labels: ["bug", "feature"] } });
    expect(out).toMatch(/watching acme\/widgets \(labels: bug, feature\)/);
  });

  it("add without --labels sends no labels field", async () => {
    const seen: Array<{ method: string; body: { repoFullName?: string; labels?: string[] } }> = [];
    const e = await env({ onWatchRequest: (req) => seen.push(req) });
    await runAsync(["watch", "add", "acme/widgets", "--login", "octocat"], e);
    expect(seen[0]!.body).toEqual({ repoFullName: "acme/widgets" });
  });

  it("remove DELETEs and reports it was unwatched", async () => {
    const seen: Array<{ method: string; body: { repoFullName?: string; labels?: string[] } }> = [];
    const e = await env({ onWatchRequest: (req) => seen.push(req) });
    const out = await runAsync(["watch", "remove", "acme/widgets", "--login", "octocat"], e);
    expect(seen[0]).toEqual({ method: "DELETE", body: { repoFullName: "acme/widgets" } });
    expect(out).toMatch(/unwatched acme\/widgets/);
  });

  it("resolves the login from LOOPOVER_LOGIN and url-encodes it", async () => {
    const requests: string[] = [];
    const e = await env({ onApiRequest: (r) => requests.push(r.url ?? "") });
    await runAsync(["watch", "list"], { ...e, LOOPOVER_LOGIN: "a b/c" });
    expect(requests.at(-1)).toBe("/v1/contributors/a%20b%2Fc/watches");
  });

  it("errors when add/remove is missing the owner/repo positional", async () => {
    const e = await env();
    const failure = runExpectingFailure(["watch", "add", "--login", "octocat"], e);
    expect(`${failure.stdout}${failure.stderr}`).toMatch(/Pass the repo: loopover-mcp watch add <owner\/repo>/);
  });

  it("errors when no login can be resolved", async () => {
    const e = await env();
    const failure = runExpectingFailure(["watch", "list"], { ...e, LOOPOVER_LOGIN: "", GITHUB_LOGIN: "" });
    expect(`${failure.stdout}${failure.stderr}`).toMatch(/Pass --login/);
  });

  it("errors on an unknown subcommand", async () => {
    const e = await env();
    const failure = runExpectingFailure(["watch", "bogus", "--login", "octocat"], e);
    expect(`${failure.stdout}${failure.stderr}`).toMatch(/Unknown watch subcommand: bogus/);
  });
});
