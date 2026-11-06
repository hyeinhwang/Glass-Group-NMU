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
//
// Google sign-in uses the OAuth 2.0 authorization-code flow with PKCE, state and
// nonce. The ID token's RS256 signature is verified against Google's published keys,
// and iss, aud, exp, nonce, email_verified and hd are all checked.
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

const SESSION_COOKIE = "nmu_session";
const OAUTH_COOKIE = "nmu_oauth";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const OAUTH_TTL_SECONDS = 10 * 60;
const GOOGLE_DEFAULTS = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"]
};
const base64url = (buffer) => Buffer.from(buffer).toString("base64url");
const sameString = (a, b) => {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};
function endpoint(value, fallback) {
  const url = new URL(value || fallback);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`Google OAuth endpoint ${url.origin} must use HTTPS.`);
  }
  return url.toString();
}

// Verifies a Google ID token. Throws with a short reason on any failure.
export async function verifyGoogleIdToken(idToken, { clientId, nonce, issuers, getKey, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  if (header.alg !== "RS256" || !header.kid) throw new Error("unexpected token algorithm");
  const jwk = await getKey(header.kid);
  if (!jwk) throw new Error("unknown signing key");
  const valid = verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`),
    createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(encodedSignature, "base64url"));
  if (!valid) throw new Error("invalid signature");
  const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  if (!issuers.includes(claims.iss)) throw new Error("wrong issuer");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(clientId)) throw new Error("wrong audience");
  if (typeof claims.exp !== "number" || claims.exp + 60 < nowSeconds) throw new Error("token expired");
  if (typeof claims.iat === "number" && claims.iat - 300 > nowSeconds) throw new Error("token issued in the future");
  if (!sameString(claims.nonce, nonce)) throw new Error("nonce mismatch");
  return claims;
}

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

  const google = {
    clientId: String(env.GOOGLE_CLIENT_ID || ""),
    clientSecret: String(env.GOOGLE_CLIENT_SECRET || ""),
    publicUrl: String(env.NMU_PUBLIC_URL || "").replace(/\/$/, ""),
    authUrl: endpoint(env.GOOGLE_OAUTH_AUTH_URL, GOOGLE_DEFAULTS.authUrl),
    tokenUrl: endpoint(env.GOOGLE_OAUTH_TOKEN_URL, GOOGLE_DEFAULTS.tokenUrl),
    jwksUrl: endpoint(env.GOOGLE_OAUTH_JWKS_URL, GOOGLE_DEFAULTS.jwksUrl),
    issuers: env.GOOGLE_OAUTH_ISSUER ? [env.GOOGLE_OAUTH_ISSUER] : GOOGLE_DEFAULTS.issuers
  };
  const problems = [];
  if (mode === "google") {
    if (!google.clientId) problems.push("GOOGLE_CLIENT_ID");
    if (!google.clientSecret) problems.push("GOOGLE_CLIENT_SECRET");
    if (!google.publicUrl) problems.push("NMU_PUBLIC_URL");
    if (!allowedDomain) problems.push("NMU_ALLOWED_EMAIL_DOMAIN");
    if (sessionSecret.length < 32) problems.push("NMU_SESSION_SECRET (32+ characters)");
  }
  const redirectUri = () => `${google.publicUrl}/auth/google/callback`;

  let jwksCache = { keys: [], expires: 0 };
  async function getGoogleKey(kid) {
    const find = () => jwksCache.keys.find((key) => key.kid === kid);
    if (jwksCache.expires > Date.now() && find()) return find();
    const response = await fetch(google.jwksUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("could not load Google signing keys");
    const body = await response.json();
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") || "")?.[1] || 3600);
    jwksCache = { keys: body.keys || [], expires: Date.now() + Math.min(maxAge, 86_400) * 1000 };
    return find();
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

  function redirect(response, location) {
    response.writeHead(302, { location, "cache-control": "no-store" });
    response.end();
  }
  const failSignIn = (response, code) => {
    appendCookie(response, cookie(OAUTH_COOKIE, "", 0, { path: "/auth/google" }));
    return redirect(response, `/?auth_error=${encodeURIComponent(code)}`);
  };

  // GET /auth/google/login → Google; GET /auth/google/callback → session → app.
  async function handleRoute(request, response, url) {
    if (request.method !== "GET" || !url.pathname.startsWith("/auth/google/")) return false;
    if (mode !== "google" || problems.length) {
      redirect(response, "/?auth_error=not_configured");
      return true;
    }
    if (url.pathname === "/auth/google/login") {
      const state = base64url(randomBytes(24));
      const nonce = base64url(randomBytes(24));
      const verifier = base64url(randomBytes(48));
      const flow = signValue({ state, nonce, verifier, exp: Math.floor(Date.now() / 1000) + OAUTH_TTL_SECONDS }, sessionSecret);
      appendCookie(response, cookie(OAUTH_COOKIE, flow, OAUTH_TTL_SECONDS, { path: "/auth/google" }));
      const target = new URL(google.authUrl);
      target.search = new URLSearchParams({
        client_id: google.clientId, redirect_uri: redirectUri(), response_type: "code",
        scope: "openid email profile", state, nonce, hd: allowedDomain, prompt: "select_account",
        code_challenge: base64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256"
      }).toString();
      redirect(response, target.toString());
      return true;
    }
    if (url.pathname === "/auth/google/callback") {
      const flow = verifySignedValue(readCookie(request, OAUTH_COOKIE), sessionSecret);
      if (!flow || !sameString(flow.state, url.searchParams.get("state"))) { failSignIn(response, "state"); return true; }
      if (url.searchParams.get("error") || !url.searchParams.get("code")) { failSignIn(response, "cancelled"); return true; }
      let claims;
      try {
        const tokenResponse = await fetch(google.tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: url.searchParams.get("code"), client_id: google.clientId, client_secret: google.clientSecret,
            redirect_uri: redirectUri(), grant_type: "authorization_code", code_verifier: flow.verifier
          }),
          signal: AbortSignal.timeout(10_000)
        });
        const tokens = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || !tokens.id_token) throw new Error(`token exchange failed (${tokenResponse.status})`);
        claims = await verifyGoogleIdToken(tokens.id_token, { clientId: google.clientId, nonce: flow.nonce, issuers: google.issuers, getKey: getGoogleKey });
      } catch (error) {
        console.warn(`Google sign-in rejected: ${error.message}`);
        failSignIn(response, "google");
        return true;
      }
      const email = String(claims.email || "").toLowerCase();
      if (claims.email_verified !== true || claims.hd !== allowedDomain || !emailInDomain(email, allowedDomain)) {
        failSignIn(response, "domain");
        return true;
      }
      if (!(await userForEmail(email))) { failSignIn(response, "not_registered"); return true; }
      appendCookie(response, cookie(OAUTH_COOKIE, "", 0, { path: "/auth/google" }));
      startSession(response, email);
      redirect(response, "/");
      return true;
    }
    return false;
  }

  return { mode, currentUser, startSession, clearSession, publicConfig, handleRoute, cookie, appendCookie, userForEmail, allowedDomain, sessionSecret, problems };
}
