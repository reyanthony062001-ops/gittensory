# Miner sizing: measured CPU/RAM/disk, laptop mode vs fleet mode

Real, measured resource numbers for running `gittensory-miner` (#5182) — one laptop-mode discover/attempt
cycle, and fleet-mode Docker workers at two worker counts — so an operator can size a host or cluster from
data instead of guessing. Every number below was measured with the commands in
[Methodology](#methodology-reproducing-these-numbers); none is estimated. Laptop numbers vary by machine, so
the measurement environment is part of the table's contract.

## Measurement environment

| | |
| --- | --- |
| Hardware | 4 vCPU Intel Xeon Platinum 8375C @ 2.90GHz, 15 GiB RAM (AWS EC2) |
| OS / kernel | Ubuntu 26.04 LTS, Linux 7.0.0-1006-aws |
| Node.js | v22.23.1 (bare laptop-mode runs) |
| Docker | 29.1.3 (fleet-mode runs; cgroup v2) |
| Miner | `@loopover/miner` 0.1.0 from a monorepo checkout, engine `@loopover/engine` 1.0.0 |
| Network | GitHub REST against live github.com (authenticated `GITHUB_TOKEN`) |

## Laptop mode — one discover/attempt cycle

Bare-Node one-shot commands against a real registered repo, measured with GNU `/usr/bin/time -v`
(peak RAM = "Maximum resident set size"; CPU% = "Percent of CPU this job got", i.e. (user+sys)/wall of one
core). State lived in a fresh `GITTENSORY_MINER_CONFIG_DIR`.

| Step | Workload | Wall time | Peak RAM | CPU | State dir after |
| --- | --- | --- | --- | --- | --- |
| `discover <repo>` | 1 repo, 93 issues fanned out, ranked + enqueued | 1.41 s | 97.4 MB | 27% of one core | 104 KB |
| `discover <repo> <repo>` | 2 repos, 183 issues (caches warm from the prior run) | 1.08 s | 103.2 MB | 38% of one core | 168 KB |
| `attempt <repo> <issue#> --dry-run` | full gated attempt path, shadow-logged | 0.34 s | 80.4 MB | 73% of one core | (same stores) |

Takeaway: a laptop-mode cycle is a short burst — roughly **≤110 MB peak RAM, well under one CPU core, and
sub-megabyte local state** per cycle. Any recent laptop is comfortably above this floor; the real laptop-mode
budget is whatever coding-agent provider you enable (see [Scope](#scope--what-these-numbers-do-not-include)).

## Fleet mode — Docker workers (N=1 and N=4)

Workers were orchestrated with [`docker-compose.miner.yml`](../docker-compose.miner.yml), one isolated compose
project per worker (`-p`, per the file's own multi-worker guidance), each running the same real one-shot
discover workload. Per-container peak RAM is the container's own cgroup-v2 `memory.peak`; CPU is cgroup
`cpu.stat` `usage_usec` (total CPU time consumed).

| Configuration | Per-worker peak RAM | Per-worker CPU time | Wall time | Per-worker volume after |
| --- | --- | --- | --- | --- |
| N=1 worker | 58.5 MB | 0.39 s | 0.96 s | ~107 KB |
| N=4 workers (parallel) | 58.7–59.2 MB | 0.50–0.53 s | 2.3–10.2 s | ~107 KB each |

Scaling notes, from the numbers:

- **RAM scales linearly and flat**: each worker peaks at ~59 MB regardless of N — budget `N × ~60 MB` + image
  overhead, with headroom for your coding-agent provider.
- **CPU contention shows up as wall time, not memory**: on this 4-vCPU host, four parallel workers each spent
  ~0.5 s of CPU but took 2.3–10.2 s wall (startup stagger + shared-host and GitHub-API contention), vs 0.96 s
  for a single worker. Fleet throughput on a small host is CPU/network-bound, not RAM-bound.
- Container peak (~59 MB) reads lower than bare-Node peak RSS (~97 MB) because the two tools count differently
  (cgroup-v2 `memory.peak` vs GNU time max RSS); both are reported as-measured.

## Disk

| Item | Measured size |
| --- | --- |
| Fleet Docker image (`gittensory-miner:latest`, full monorepo `npm ci` build) | 1.64 GB |
| Named volume per worker after one discover cycle | ~107 KB |
| Laptop-mode `GITTENSORY_MINER_CONFIG_DIR` after a discover/attempt cycle | 104–168 KB |

The image is the dominant disk cost; local SQLite state is negligible at this stage and grows append-only with
attempt/prediction history (see [`observability.md`](./observability.md) for what accumulates there).

## Methodology (reproducing these numbers)

Laptop mode — fresh state dir, real GitHub reads, no writes to any repo (`discover` is read-only; `--dry-run`
attempts never invoke a coding agent or push):

```sh
export GITTENSORY_MINER_CONFIG_DIR=$(mktemp -d)
/usr/bin/time -v gittensory-miner discover JSONbored/gittensory --json > /dev/null
/usr/bin/time -v gittensory-miner attempt JSONbored/gittensory <open-issue#> --miner-login <login> --dry-run --json > /dev/null
du -sk "$GITTENSORY_MINER_CONFIG_DIR"
```

Read peak RAM from `Maximum resident set size` and CPU from `Percent of CPU this job got` in the
`/usr/bin/time -v` output.

Fleet mode — build the image, then run each worker as its own compose project with the command overridden to a
real one-shot workload that prints its own cgroup readings on exit:

```sh
docker build -f packages/gittensory-miner/Dockerfile -t gittensory-miner:latest .
# sizing-override.yml (see caveat below):
#   services:
#     miner:
#       entrypoint: ["sh", "-c"]
#       command:
#         - >
#           START=$(date +%s%N);
#           gittensory-miner discover JSONbored/gittensory --json > /dev/null;
#           END=$(date +%s%N);
#           echo "SIZING wall_ms=$(( (END - START) / 1000000 ))";
#           echo "SIZING memory_peak_bytes=$(cat /sys/fs/cgroup/memory.peak)";
#           echo "SIZING $(grep usage_usec /sys/fs/cgroup/cpu.stat | head -1)";
#       restart: "no"
cd packages/gittensory-miner
docker compose -p sizing-1 -f docker-compose.miner.yml -f sizing-override.yml up --no-build --abort-on-container-exit
# N=4: launch four projects (sizing-1 … sizing-4) in parallel and read each project's SIZING log lines.
docker system df -v   # per-worker named-volume sizes
```

Command-override caveat: this measurement overrides the compose file's default `command: ["run"]`, because no
`run` subcommand exists in the CLI today (`gittensory-miner run` prints "Unknown command"; the documented
long-lived form is `loop`). A worker booted with the file's defaults therefore crash-loops under
`restart: unless-stopped` rather than idling, so there is no steady-state resident workload to measure yet —
the one-shot discover above is the real per-cycle work a fleet worker performs.

## Scope — what these numbers do NOT include

- **The coding-agent subprocess.** A live attempt spawns the configured provider (`claude-cli`, `codex-cli`,
  or `agent-sdk`), whose CPU/RAM dwarfs the miner's own and varies entirely by provider — measure your
  provider separately. The attempt row above is the miner's own gated attempt path (`--dry-run`, which is also
  the only mode that is safe and reproducible against real repos: a `--live` measurement would open real PRs).
- **Discovery breadth.** `discover` cost scales with the repo count and open-issue volume you point it at
  (93–183 issues here); a much larger portfolio will scale the fan-out accordingly, bounded by GitHub API rate
  limits (`rateLimitRemaining` is reported in the `--json` output).
- **Warm caches.** The two-repo discover ran after the single-repo one, with `policy-doc-cache` / HTTP caches
  already warm — cold first runs pay slightly more wall time.
