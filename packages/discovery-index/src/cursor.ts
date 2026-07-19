// Opaque forward-pagination cursor for DiscoveryIndexQuery.cursor / DiscoveryIndexResponse.nextCursor
// (packages/loopover-engine/src/discovery-index-contract.ts). The contract types both fields as an opaque
// `string | null` with no encode/decode helper anywhere in the repo (checked: no existing cursor scheme to
// reuse), so this server is free to define its own. Encodes a plain offset into the cached, deterministically
// ordered result set for a given query scope (see discovery-query.ts) — base64-JSON rather than a bare
// integer only so a caller can never mistake it for a meaningful number to increment/guess.

const CURSOR_VERSION = 1;

interface CursorPayload {
  v: number;
  offset: number;
}

/** Encode a page offset into an opaque cursor string. */
export function encodeCursor(offset: number): string {
  const payload: CursorPayload = { v: CURSOR_VERSION, offset };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

/**
 * Decode an opaque cursor back into a page offset. Never throws, matching the contract's own tolerant-parser
 * convention (packages/loopover-engine/src/discovery-index-contract.ts's header comment): a null cursor, an
 * unparseable cursor, a wrong-version cursor, or a negative/non-finite offset all degrade to offset 0 (the
 * first page) rather than erroring.
 */
export function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
  } catch {
    return 0;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
  const payload = parsed as Record<string, unknown>;
  if (payload.v !== CURSOR_VERSION) return 0;
  const offset = payload.offset;
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}
