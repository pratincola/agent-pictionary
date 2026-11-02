import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { Role } from "@pictionary/protocol";

// ---------------------------------------------------------------------------
// API keys: "<agentId>.<secret>"; only scrypt(secret) is stored.
// ---------------------------------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 32;

export function generateApiKey(agentId: string): { apiKey: string; hash: string } {
  const secret = randomBytes(24).toString("base64url");
  return { apiKey: `${agentId}.${secret}`, hash: hashSecret(secret) };
}

export function hashSecret(secret: string, salt = randomBytes(16).toString("base64url")): string {
  const dk = scryptSync(secret, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: 8, p: 1 });
  return `scrypt$${SCRYPT_N}$${salt}$${dk.toString("base64url")}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const salt = parts[2] as string;
  const expected = Buffer.from(parts[3] as string, "base64url");
  const dk = scryptSync(secret, salt, expected.length, { N: n, r: 8, p: 1 });
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

/** Splits "<agentId>.<secret>"; null when malformed. */
export function splitApiKey(apiKey: string): { agentId: string; secret: string } | null {
  const i = apiKey.indexOf(".");
  if (i <= 0 || i === apiKey.length - 1) return null;
  return { agentId: apiKey.slice(0, i), secret: apiKey.slice(i + 1) };
}

export function generatePairCode(): string {
  return randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8).toUpperCase();
}

// ---------------------------------------------------------------------------
// Session tokens: base64url(json).base64url(hmac-sha256)
// ---------------------------------------------------------------------------

export interface SessionClaims {
  sid: string;
  code: string;
  role: Role;
  agentId?: string;
  humanId?: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

export function signSessionToken(claims: SessionClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  now = Date.now(),
): SessionClaims | null {
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const body = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionClaims;
    if (
      typeof claims.sid !== "string" ||
      typeof claims.code !== "string" ||
      typeof claims.exp !== "number"
    )
      return null;
    if (claims.exp < now) return null;
    return claims;
  } catch {
    return null;
  }
}

export function newId(): string {
  return randomUUID();
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++)
    out += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length];
  return out;
}
