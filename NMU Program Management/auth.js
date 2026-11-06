// Authentication without stored passwords.
//
// Identity: an email address. Authorization: the matching Airtable Users record and
// its Rights field (Admin, Manager, Contributor) – looked up on every request, so a
// change in Airtable takes effect within the store's cache window.
//
// Modes
//   google (default) – Google sign-in, restricted to NMU_ALLOWED_EMAIL_DOMAIN.
//   dev              – local development only: identity comes from the x-dev-user
//                      header or NMU_DEV_USER_EMAIL. Refused when NODE_ENV=production.
//
// Sessions are stateless HMAC-signed cookies (NMU_SESSION_SECRET) holding only the
// email and an expiry; nothing is written to disk.
import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "nmu_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export function readCookie(request, name) {
  const header = request.headers.cookie || "";
  const part = header.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  if (!part) return "";
  try { return decodeURIComponent(part.slice(name.length + 1)); } catch { return ""; }
}

export function signValue(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifySignedValue(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature || !secret) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

export function emailInDomain(email, domain) {
  const normalized = String(email || "").trim().toLowerCase();
  const wanted = String(domain || "").trim().toLowerCase().replace(/^@/, "");
  return Boolean(wanted) && normalized.endsWith(`@${wanted}`) && normalized.indexOf("@") === normalized.lastIndexOf("@");
}

export function createAuth({ env = process.env, findUserByEmail }) {
  const mode = env.NMU_AUTH_MODE === "dev" ? "dev" : "google";
  if (mode === "dev" && env.NODE_ENV === "production") {
    throw new Error("NMU_AUTH_MODE=dev is not allowed when NODE_ENV=production. Configure Google sign-in instead.");
  }
  const allowedDomain = String(env.NMU_ALLOWED_EMAIL_DOMAIN || "").trim().toLowerCase().replace(/^@/, "");
  const sessionSecret = String(env.NMU_SESSION_SECRET || "");
  const secureCookies = env.NODE_ENV === "production" || env.NMU_SECURE_COOKIES === "true";

  const problems = [];
  if (mode === "google") {
    if (!allowedDomain) problems.push("NMU_ALLOWED_EMAIL_DOMAIN");
    if (sessionSecret.length < 32) problems.push("NMU_SESSION_SECRET (32+ characters)");
  }

  function cookie(name, value, maxAge, { sameSite = "Lax", path = "/" } = {}) {
    return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secureCookies ? "; Secure" : ""}`;
  }
  function appendCookie(response, value) {
    const existing = response.getHeader("Set-Cookie");
    response.setHeader("Set-Cookie", [...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []), value]);
  }

  async function userForEmail(email) {
    const user = await findUserByEmail(email);
    return user && user.role ? user : null;
  }

  async function currentUser(request) {
    if (mode === "dev") {
      const email = String(request.headers["x-dev-user"] || env.NMU_DEV_USER_EMAIL || "").trim().toLowerCase();
      return email ? userForEmail(email) : null;
    }
    if (problems.length) return null;
    const session = verifySignedValue(readCookie(request, SESSION_COOKIE), sessionSecret);
    if (!session?.email || !emailInDomain(session.email, allowedDomain)) return null;
    return userForEmail(session.email);
  }

  function startSession(response, email) {
    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    appendCookie(response, cookie(SESSION_COOKIE, signValue({ email, exp }, sessionSecret), SESSION_TTL_SECONDS));
  }
  function clearSession(response) {
    appendCookie(response, cookie(SESSION_COOKIE, "", 0));
  }

  function publicConfig() {
    return {
      mode,
      allowedDomain: allowedDomain || null,
      googleConfigured: mode === "google" && !problems.length,
      missingConfiguration: problems
    };
  }

  // Google sign-in routes are added in the next step.
  async function handleRoute() { return false; }

  return { mode, currentUser, startSession, clearSession, publicConfig, handleRoute, cookie, appendCookie, userForEmail, allowedDomain, sessionSecret, problems };
}
