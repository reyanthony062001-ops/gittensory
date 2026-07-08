import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { resolveR2PublicUploadConfig, signR2PutRequest, uploadToPublicR2Bucket } from "../../src/selfhost/r2-public-upload";

const FAKE_CONFIG = {
  accountId: "abc123def456",
  bucket: "gittensory-visual-capture-public",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  publicBaseUrl: "https://pub-example.r2.dev",
};

describe("signR2PutRequest (#4184 public screenshot bucket)", () => {
  it("regression: matches an independently Python-computed SigV4 signature for a fixed test vector", () => {
    // Cross-checked against Python's hmac/hashlib computing the identical canonical-request/signing-key
    // chain by hand, for the SAME inputs -- an independent implementation agreeing on the exact signature
    // is much stronger evidence of correctness than this test suite alone could ever provide.
    const payloadHash = createHash("sha256").update("test-png-bytes").digest("hex");
    const result = signR2PutRequest({
      method: "PUT",
      host: "abc123def456.r2.cloudflarestorage.com",
      uri: "/gittensory-visual-capture-public/gittensory/shots/deadbeef.png",
      amzDate: "20260708T113000Z",
      dateStamp: "20260708",
      contentType: "image/png",
      payloadHash,
      accessKeyId: FAKE_CONFIG.accessKeyId,
      secretAccessKey: FAKE_CONFIG.secretAccessKey,
    });
    expect(result).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260708/auto/s3/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=c600d5c7b73c198bdf627a1e4ad1079627c35653e54ee829ffbf1b4752be067c",
    );
  });

  it("is a pure function of its inputs: identical inputs always produce identical output", () => {
    const req = {
      method: "PUT" as const,
      host: "h.r2.cloudflarestorage.com",
      uri: "/bucket/key.png",
      amzDate: "20260101T000000Z",
      dateStamp: "20260101",
      contentType: "image/png",
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      accessKeyId: "ak",
      secretAccessKey: "sk",
    };
    expect(signR2PutRequest(req)).toBe(signR2PutRequest({ ...req }));
  });

  it("a different secret key produces a different signature (the signing key actually depends on it)", () => {
    const req = {
      method: "PUT" as const,
      host: "h.r2.cloudflarestorage.com",
      uri: "/bucket/key.png",
      amzDate: "20260101T000000Z",
      dateStamp: "20260101",
      contentType: "image/png",
      payloadHash: "abc",
      accessKeyId: "ak",
      secretAccessKey: "sk-one",
    };
    expect(signR2PutRequest(req)).not.toBe(signR2PutRequest({ ...req, secretAccessKey: "sk-two" }));
  });
});

describe("uploadToPublicR2Bucket (#4184)", () => {
  it("returns undefined immediately (no fetch) when config is undefined", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const url = await uploadToPublicR2Bucket(undefined, "some/key.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(url).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns the public URL (base + key) on a successful PUT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true }),
    );
    const url = await uploadToPublicR2Bucket(FAKE_CONFIG, "gittensory/shots/abc123.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(url).toBe("https://pub-example.r2.dev/gittensory/shots/abc123.png");
    vi.unstubAllGlobals();
  });

  it("strips a trailing slash from publicBaseUrl before joining the key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const url = await uploadToPublicR2Bucket(
      { ...FAKE_CONFIG, publicBaseUrl: "https://pub-example.r2.dev/" },
      "k.png",
      new Uint8Array(),
      "image/png",
    );
    expect(url).toBe("https://pub-example.r2.dev/k.png");
    vi.unstubAllGlobals();
  });

  it("percent-encodes SigV4's extra reserved chars (!'()*) in the request URI, which encodeURIComponent alone leaves untouched", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    await uploadToPublicR2Bucket(FAKE_CONFIG, "test(1)!'*.png", new Uint8Array(), "image/png");
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe("https://abc123def456.r2.cloudflarestorage.com/gittensory-visual-capture-public/test%281%29%21%27%2A.png");
    vi.unstubAllGlobals();
  });

  it("returns undefined when the PUT responds non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const url = await uploadToPublicR2Bucket(FAKE_CONFIG, "k.png", new Uint8Array(), "image/png");
    expect(url).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("returns undefined (never throws) when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const url = await uploadToPublicR2Bucket(FAKE_CONFIG, "k.png", new Uint8Array(), "image/png");
    expect(url).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("sends a real Authorization header built from the configured credentials", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    await uploadToPublicR2Bucket(FAKE_CONFIG, "k.png", new Uint8Array([9]), "image/png");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://abc123def456.r2.cloudflarestorage.com/gittensory-visual-capture-public/k.png");
    expect(init.method).toBe("PUT");
    expect(init.headers.authorization).toContain(`Credential=${FAKE_CONFIG.accessKeyId}/`);
    expect(init.headers["content-type"]).toBe("image/png");
    vi.unstubAllGlobals();
  });
});

describe("resolveR2PublicUploadConfig (#4184)", () => {
  const FULL_ENV = {
    R2_PUBLIC_ACCOUNT_ID: "acct",
    R2_PUBLIC_BUCKET: "bucket",
    R2_PUBLIC_ACCESS_KEY_ID: "ak",
    R2_PUBLIC_SECRET_ACCESS_KEY: "sk",
    R2_PUBLIC_BASE_URL: "https://pub.r2.dev",
  };

  it("resolves a full config object when every var is set", () => {
    expect(resolveR2PublicUploadConfig(FULL_ENV)).toEqual({
      accountId: "acct",
      bucket: "bucket",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      publicBaseUrl: "https://pub.r2.dev",
    });
  });

  it("returns undefined (not a partial config) when any single var is missing -- one absent field for each", () => {
    for (const key of Object.keys(FULL_ENV) as (keyof typeof FULL_ENV)[]) {
      const partial = { ...FULL_ENV, [key]: undefined };
      expect(resolveR2PublicUploadConfig(partial)).toBeUndefined();
    }
  });

  it("returns undefined when nothing at all is configured -- the legitimate not-opted-in default", () => {
    expect(resolveR2PublicUploadConfig({})).toBeUndefined();
  });
});
