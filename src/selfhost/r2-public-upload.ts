// Self-host public screenshot bucket (JSONbored/gittensory#4184 follow-up). Self-host's REVIEW_AUDIT is a
// LOCAL-FILESYSTEM store (blob-store.ts) served through this instance's own /gittensory/shot route -- fine
// for a self-host box that stays fully private (Tailscale-only, no public HTTP surface by design), but that
// means the URL embedded in a public PR comment is never fetchable by GitHub. Rather than requiring the whole
// instance to expose a public origin, upload the SAME captured PNG a second time to a dedicated, deliberately
// PUBLIC Cloudflare R2 bucket and link directly to ITS public URL instead -- the private instance itself never
// needs to answer a single public request.
//
// Self-host only (Node's node:crypto for SigV4; the Worker bundle never imports this). No new dependency: R2's
// S3-compatible API needs AWS SigV4 request signing, implemented here directly rather than pulling in the full
// @aws-sdk/client-s3 (its transitive dependency weight buys nothing over a few dozen lines of HMAC chaining for
// the ONE operation this needs -- a single-object PUT, no multipart, no listing, no other S3 verb).
import { createHash, createHmac } from "node:crypto";

const SERVICE = "s3";
const REGION = "auto";
const ALGORITHM = "AWS4-HMAC-SHA256";

export type R2PublicUploadConfig = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** The bucket's public base URL (its r2.dev dev URL, or a custom domain) -- no trailing slash. */
  publicBaseUrl: string;
};

function hex(input: Buffer): string {
  return input.toString("hex");
}

function sha256HexBytes(bytes: Uint8Array | string): string {
  return hex(createHash("sha256").update(bytes).digest());
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** URI-encode one path segment the way SigV4's canonical URI requires (RFC 3986 unreserved chars kept
 *  literal; every other byte percent-encoded, uppercase hex) -- stricter than `encodeURIComponent`, which
 *  leaves `!'()*` unescaped. */
function encodeUriSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalUri(bucket: string, key: string): string {
  const segments = `${bucket}/${key}`.split("/").map(encodeUriSegment);
  return `/${segments.join("/")}`;
}

function amzTimestamps(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // -> YYYYMMDDTHHMMSSZ
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function signingKey(secretAccessKey: string, dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

export type R2SigV4Request = {
  method: "PUT";
  host: string;
  uri: string;
  amzDate: string;
  dateStamp: string;
  contentType: string;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** Build the SigV4 Authorization header value for one PUT request. Pure -- every timestamp/hash is a
 *  parameter, never computed internally, so this is fully deterministic and unit-testable without touching
 *  the network or the system clock. */
export function signR2PutRequest(req: R2SigV4Request): string {
  const canonicalHeaders =
    `content-type:${req.contentType}\n` +
    `host:${req.host}\n` +
    `x-amz-content-sha256:${req.payloadHash}\n` +
    `x-amz-date:${req.amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [req.method, req.uri, "", canonicalHeaders, signedHeaders, req.payloadHash].join("\n");

  const credentialScope = `${req.dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, req.amzDate, credentialScope, sha256HexBytes(canonicalRequest)].join("\n");

  const signature = hex(hmac(signingKey(req.secretAccessKey, req.dateStamp), stringToSign));
  return `${ALGORITHM} Credential=${req.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/** The public URL a key would have IF it's already in the bucket -- no network call, just string-building.
 *  Used both as `uploadToPublicR2Bucket`'s own success return value and by a caller that already knows (by
 *  its own convention) that a given key was uploaded on a previous call and wants to reconstruct the same
 *  URL without paying for a redundant upload. */
export function publicUrlForKey(config: R2PublicUploadConfig, key: string): string {
  return `${config.publicBaseUrl.replace(/\/+$/, "")}/${key}`;
}

/** Upload `bytes` to the configured public R2 bucket under `key` and return its public URL, or undefined on
 *  any failure (missing config, network error, non-2xx response) -- mirrors capture.ts's own "never throw,
 *  degrade to no URL" convention so a bucket outage can never sink a review. */
export async function uploadToPublicR2Bucket(
  config: R2PublicUploadConfig | undefined,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string | undefined> {
  if (!config) return undefined;
  try {
    const host = `${config.accountId}.r2.cloudflarestorage.com`;
    const uri = canonicalUri(config.bucket, key);
    const { amzDate, dateStamp } = amzTimestamps(new Date());
    const payloadHash = sha256HexBytes(bytes);
    const authorization = signR2PutRequest({
      method: "PUT",
      host,
      uri,
      amzDate,
      dateStamp,
      contentType,
      payloadHash,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
    const response = await fetch(`https://${host}${uri}`, {
      method: "PUT",
      headers: {
        "content-type": contentType,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        authorization,
      },
      body: bytes,
    });
    if (!response.ok) return undefined;
    return publicUrlForKey(config, key);
  } catch {
    return undefined;
  }
}

/** Resolve the public-bucket config from env, or undefined when any piece is missing -- absent config is the
 *  legitimate "not opted in" case (captures keep using the private-instance-served URL, exactly as before
 *  this feature), not an error. */
export function resolveR2PublicUploadConfig(env: {
  R2_PUBLIC_ACCOUNT_ID?: string | undefined;
  R2_PUBLIC_BUCKET?: string | undefined;
  R2_PUBLIC_ACCESS_KEY_ID?: string | undefined;
  R2_PUBLIC_SECRET_ACCESS_KEY?: string | undefined;
  R2_PUBLIC_BASE_URL?: string | undefined;
}): R2PublicUploadConfig | undefined {
  const { R2_PUBLIC_ACCOUNT_ID, R2_PUBLIC_BUCKET, R2_PUBLIC_ACCESS_KEY_ID, R2_PUBLIC_SECRET_ACCESS_KEY, R2_PUBLIC_BASE_URL } = env;
  if (!R2_PUBLIC_ACCOUNT_ID || !R2_PUBLIC_BUCKET || !R2_PUBLIC_ACCESS_KEY_ID || !R2_PUBLIC_SECRET_ACCESS_KEY || !R2_PUBLIC_BASE_URL) {
    return undefined;
  }
  return {
    accountId: R2_PUBLIC_ACCOUNT_ID,
    bucket: R2_PUBLIC_BUCKET,
    accessKeyId: R2_PUBLIC_ACCESS_KEY_ID,
    secretAccessKey: R2_PUBLIC_SECRET_ACCESS_KEY,
    publicBaseUrl: R2_PUBLIC_BASE_URL,
  };
}
