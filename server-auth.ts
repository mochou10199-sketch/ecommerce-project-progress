import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { sessions, teamRoles, teams, users } from "../../db/schema";
import { DEFAULT_ROLE_DEFINITIONS, parseStoredPermissions, type Permission } from "./role-options";

const SESSION_COOKIE = "ep_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
// Cloudflare Workers WebCrypto supports at most 100,000 PBKDF2 iterations.
const PASSWORD_ITERATIONS = 100_000;

export type AuthUser = {
  id: string;
  teamId: string;
  teamCode: string;
  teamName: string;
  username: string;
  role: string;
  roleName: string;
  permissions: Permission[];
  mustChangePassword: boolean;
};

export type AuthResult =
  | { user: AuthUser; token: string }
  | { user: null; token: null };

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(hash));
}

async function derivePasswordHash(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return toBase64Url(new Uint8Array(bits));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    salt: toBase64Url(salt),
    hash: await derivePasswordHash(password, salt),
  };
}

export async function verifyPassword(password: string, saltValue: string, expectedHash: string) {
  const actualHash = await derivePasswordHash(password, fromBase64Url(saltValue));
  return actualHash === expectedHash;
}

function fallbackRole(roleCode: string) {
  const definition = DEFAULT_ROLE_DEFINITIONS.find((role) => role.code === roleCode);
  if (definition) return { name: definition.name, permissions: [...definition.permissions] };
  return { name: "待配置角色", permissions: [] as Permission[] };
}

export async function resolveTeamRole(teamId: string, roleCode: string) {
  try {
    const [role] = await getDb().select({
      code: teamRoles.code,
      name: teamRoles.name,
      permissions: teamRoles.permissions,
      isActive: teamRoles.isActive,
    }).from(teamRoles).where(and(
      eq(teamRoles.teamId, teamId),
      eq(teamRoles.code, roleCode),
    )).limit(1);
    if (role) return {
      name: role.isActive ? role.name : "角色已停用",
      permissions: role.isActive ? parseStoredPermissions(role.permissions) : [],
    };
  } catch {
    // Keep existing teams readable during the short window before 0005 is applied.
  }
  return fallbackRole(roleCode);
}

export async function buildAuthUser(input: Omit<AuthUser, "roleName" | "permissions">): Promise<AuthUser> {
  const role = await resolveTeamRole(input.teamId, input.role);
  return { ...input, roleName: role.name, permissions: role.permissions };
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

function sessionCookie(request: Request, token: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookie(request: Request) {
  return sessionCookie(request, "", 0);
}

export async function createSession(request: Request, user: AuthUser) {
  const db = getDb();
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();

  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId: user.id,
    teamId: user.teamId,
    tokenHash: await digest(token),
    expiresAt,
    createdAt: now.toISOString(),
  });

  return {
    token,
    cookie: sessionCookie(request, token, SESSION_TTL_SECONDS),
    expiresAt,
  };
}

export async function revokeSession(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;

  const db = getDb();
  await db.update(sessions)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(sessions.tokenHash, await digest(token)));
}

export async function getCurrentSessionTokenHash(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  return token ? digest(token) : null;
}

export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const db = getDb();
  const [session] = await db.select().from(sessions).where(eq(sessions.tokenHash, await digest(token))).limit(1);
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) return null;

  const [user] = await db.select().from(users)
    .where(and(eq(users.id, session.userId), eq(users.teamId, session.teamId), eq(users.status, "active")))
    .limit(1);
  if (!user) return null;

  const [team] = await db.select().from(teams)
    .where(and(eq(teams.id, session.teamId), eq(teams.status, "active")))
    .limit(1);
  if (!team) return null;

  return buildAuthUser({
    id: user.id,
    teamId: user.teamId,
    teamCode: team.code,
    teamName: team.name,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
}

export function getCookieHeader(request: Request, token: string, maxAge = SESSION_TTL_SECONDS) {
  return sessionCookie(request, token, maxAge);
}
