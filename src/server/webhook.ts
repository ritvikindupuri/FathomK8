import { createHmac, timingSafeEqual } from "crypto";

export function verifyGithubSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const digest = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const actual = Buffer.from(header);
  const expected = Buffer.from(digest);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
