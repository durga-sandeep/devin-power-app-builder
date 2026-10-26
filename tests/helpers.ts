import { SESSION_COOKIE, signSession } from "@/lib/platform/auth";
import { cookieJar } from "./setup";

export const USERS = {
  viewer: "user_viewer",
  maker: "user_maker",
  checker: "user_checker",
  admin: "user_admin",
} as const;

export function actAs(role: keyof typeof USERS | null) {
  if (role === null) cookieJar.delete(SESSION_COOKIE);
  else cookieJar.set(SESSION_COOKIE, signSession(USERS[role]));
}

export function tamperedCookie(role: keyof typeof USERS) {
  cookieJar.set(SESSION_COOKIE, `${USERS[role]}.not-a-valid-signature`);
}
