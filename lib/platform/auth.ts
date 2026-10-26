import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export const ROLES = ["viewer", "maker", "checker", "admin"] as const;
export type Role = (typeof ROLES)[number];

export type CurrentUser = { id: string; name: string; email: string; role: Role };

export const SESSION_COOKIE = "dev_session";

/** Thrown by requireRole(). `status` is 401 when nobody is logged in, 403 when the role is wrong. */
export class ForbiddenError extends Error {
  readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403 = 403) {
    super(message);
    this.name = "ForbiddenError";
    this.status = status;
  }
}

/** The value committed in `.env`. It only ever signs the dev-login cookie and is public. */
export const DEV_SESSION_SECRET = "dev-only-session-secret-change-in-prod";

/**
 * The dev login page is the SSO stand-in. It must not be reachable in production unless explicitly
 * enabled (e.g. a sealed demo environment) via ALLOW_DEV_LOGIN=1.
 */
export function assertDevLoginAllowed() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_LOGIN !== "1") {
    throw new ForbiddenError("Dev login is disabled in production; sign in through SSO", 403);
  }
}

function secret() {
  const value = process.env.SESSION_SECRET ?? DEV_SESSION_SECRET;
  if (process.env.NODE_ENV === "production" && value === DEV_SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be set to a non-default value in production");
  }
  return value;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** Cookie payload is `<userId>.<hmac>`; the HMAC stops anyone editing the cookie to pick a role. */
export function signSession(userId: string) {
  return `${userId}.${sign(userId)}`;
}

export function verifySession(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = cookieValue.slice(0, dot);
  const given = Buffer.from(cookieValue.slice(dot + 1));
  const expected = Buffer.from(sign(userId));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return userId;
}

/**
 * Reads the signed dev-login cookie and loads the user. Returns null when nobody is logged in.
 * This is the one place that knows about the cookie; swapping to Entra ID / OIDC means replacing
 * the body of this function only.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const userId = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !isRole(user.role)) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/** Server-side gate for every mutation. UI hiding is cosmetic; this is the real check. */
export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ForbiddenError("Not logged in", 401);
  if (!roles.includes(user.role)) {
    throw new ForbiddenError(`Role '${user.role}' may not do this (needs ${roles.join(" or ")})`);
  }
  return user;
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
