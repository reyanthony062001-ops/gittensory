import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../../packages/discovery-index/src/cursor";

describe("discovery-index opaque cursor (#7164)", () => {
  it("round-trips an offset through encode/decode", () => {
    expect(decodeCursor(encodeCursor(0))).toBe(0);
    expect(decodeCursor(encodeCursor(50))).toBe(50);
  });

  it("decodes a null cursor as offset 0 (first page)", () => {
    expect(decodeCursor(null)).toBe(0);
  });

  it("degrades malformed input to offset 0 rather than throwing", () => {
    expect(decodeCursor("not-valid-base64-json!!!")).toBe(0);
    expect(decodeCursor(Buffer.from("not json", "utf8").toString("base64"))).toBe(0);
    expect(decodeCursor(Buffer.from("null", "utf8").toString("base64"))).toBe(0);
    expect(decodeCursor(Buffer.from("[1,2]", "utf8").toString("base64"))).toBe(0);
    expect(decodeCursor(Buffer.from(JSON.stringify("a string"), "utf8").toString("base64"))).toBe(0);
  });

  it("degrades a wrong contract version to offset 0", () => {
    const wrongVersion = Buffer.from(JSON.stringify({ v: 2, offset: 10 }), "utf8").toString("base64");
    expect(decodeCursor(wrongVersion)).toBe(0);
  });

  it("degrades a non-numeric, negative, or non-finite offset to 0", () => {
    const nonNumeric = Buffer.from(JSON.stringify({ v: 1, offset: "ten" }), "utf8").toString("base64");
    expect(decodeCursor(nonNumeric)).toBe(0);
    const negative = Buffer.from(JSON.stringify({ v: 1, offset: -5 }), "utf8").toString("base64");
    expect(decodeCursor(negative)).toBe(0);
    const nonFinite = Buffer.from('{"v":1,"offset":null}', "utf8").toString("base64");
    expect(decodeCursor(nonFinite)).toBe(0);
  });

  it("floors a fractional offset", () => {
    const fractional = Buffer.from(JSON.stringify({ v: 1, offset: 5.7 }), "utf8").toString("base64");
    expect(decodeCursor(fractional)).toBe(5);
  });
});
