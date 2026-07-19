import { describe, expect, it } from "vitest";
import { normalizeSharedSecret, verifyBearer } from "../../../packages/discovery-index/src/auth";

describe("discovery-index auth (#7164)", () => {
  it("normalizeSharedSecret trims copied whitespace and surrounding quotes", () => {
    expect(normalizeSharedSecret('  "sek"\n')).toBe("sek");
    expect(normalizeSharedSecret(" 'sek' ")).toBe("sek");
    expect(normalizeSharedSecret(" \n ")).toBeUndefined();
    expect(normalizeSharedSecret(undefined)).toBeUndefined();
    expect(normalizeSharedSecret('""')).toBeUndefined(); // quotes stripped from an empty string stay empty
  });

  it("verifyBearer accepts normalized service secrets and bearer tokens", () => {
    expect(verifyBearer("Bearer sek", "sek")).toBe(true);
    expect(verifyBearer("Bearer   sek  ", ' "sek"\n')).toBe(true);
    expect(verifyBearer("bearer sek", "sek")).toBe(true);
  });

  it("verifyBearer rejects missing, malformed, and mismatched headers", () => {
    expect(verifyBearer(undefined, "sek")).toBe(false);
    expect(verifyBearer("Basic sek", "sek")).toBe(false);
    expect(verifyBearer("Bearer nope", "sek")).toBe(false);
    expect(verifyBearer("Bearer sek", " \n ")).toBe(false);
    expect(verifyBearer("Bearer sekret", "sek")).toBe(false);
  });
});
