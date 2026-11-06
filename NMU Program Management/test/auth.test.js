import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { createFixtureAirtable } from "./helpers/fixture.js";
import { startApp } from "./helpers/server.js";
import { emailInDomain, signValue, verifySignedValue } from "../auth.js";

const CLIENT_ID = "nmu-test-client.apps.googleusercontent.com";
const SESSION_SECRET = "test-session-secret-that-is-long-enough-123";
const signingKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...signingKey.publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };

let airtable;
let google;
let googleUrl;
let app;
const pendingCodes = new Map();
const tokenRequests = [];

function idToken(claims, { key = signingKey.privateKey, kid = "test-key" } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), key).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

before(async () => {
  airtable = createFixtureAirtable();
  const apiRoot = await airtable.start();
  google = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const json = (status, body) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "max-age=600" }); response.end(JSON.stringify(body)); };
    if (url.pathname === "/certs") return json(200, { keys: [jwk] });
    if (url.pathname === "/token" && request.method === "POST") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const form = new URLSearchParams(raw);
      tokenRequests.push(Object.fromEntries(form));
      const pending = pendingCodes.get(form.get("code"));
      if (!pending || form.get("client_secret") !== "test-secret") return json(400, { error: "invalid_grant" });
      const challenge = createHash("sha256").update(form.get("code_verifier")).digest("base64url");
      if (challenge !== pending.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE mismatch" });
      return json(200, { id_token: pending.token, access_token: "unused" });
    }
    return json(404, {});
  });
  await new Promise((resolve) => google.listen(0, "127.0.0.1", resolve));
  googleUrl = `http://127.0.0.1:${google.address().port}`;
  app = await startApp({
    NODE_ENV: "production", AIRTABLE_API_KEY: "test-token", AIRTABLE_BASE_ID: airtable.baseId, AIRTABLE_API_ROOT: apiRoot,
    GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "test-secret", NMU_ALLOWED_EMAIL_DOMAIN: "nmu.test",
    NMU_SESSION_SECRET: SESSION_SECRET, NMU_PUBLIC_URL: "https://nmu.example",
    GOOGLE_OAUTH_AUTH_URL: `${googleUrl}/auth`, GOOGLE_OAUTH_TOKEN_URL: `${googleUrl}/token`,
    GOOGLE_OAUTH_JWKS_URL: `${googleUrl}/certs`, GOOGLE_OAUTH_ISSUER: "https://accounts.google.com"
  });
  assert.equal(app.child.exitCode, null, app.output());
});
after(async () => {
  await app?.stop();
  await airtable?.close();
  await new Promise((resolve) => google?.close(resolve));
});

const cookiesFrom = (response) => response.headers.getSetCookie();
const cookiePair = (setCookies, name) => setCookies.find((item) => item.startsWith(`${name}=`))?.split(";")[0] || "";

// Runs the redirect → Google → callback round trip and returns the callback response.
async function signIn(claimsFor, { token, tamperState = false } = {}) {
  const login = await fetch(`${app.url}/auth/google/login`, { redirect: "manual" });
  assert.equal(login.status, 302);
  const location = new URL(login.headers.get("location"));
  const params = location.searchParams;
  const oauthCookie = cookiePair(cookiesFrom(login), "nmu_oauth");
  const claims = claimsFor({ nonce: params.get("nonce") });
  const code = `code-${Math.random()}`;
  pendingCodes.set(code, { challenge: params.get("code_challenge"), token: token ? token(claims) : idToken(claims) });
  const state = tamperState ? "forged-state" : params.get("state");
  const callback = await fetch(`${app.url}/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, {
    redirect: "manual", headers: { cookie: oauthCookie }
  });
  return { login, location, callback };
}
const claims = (email, extra = {}) => ({ nonce }) => ({
  iss: "https://accounts.google.com", aud: CLIENT_ID, sub: `sub-${email}`, email, email_verified: true,
  hd: email.split("@")[1], iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, nonce, ...extra
});

test("Google sign-in", async (t) => {
  await t.test("advertises Google sign-in and offers no password login", async () => {
    const config = await (await fetch(`${app.url}/api/auth/config`)).json();
    assert.deepEqual(config, { mode: "google", allowedDomain: "nmu.test", googleConfigured: true, missingConfiguration: [] });
    const passwordLogin = await fetch(`${app.url}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json", origin: app.url.replace("http://", "http://") },
      body: JSON.stringify({ email: "admin@nmu.test", password: "anything" })
    });
    assert.ok([401, 403, 404].includes(passwordLogin.status));
    assert.equal((await fetch(`${app.url}/api/bootstrap`, { headers: { "x-dev-user": "admin@nmu.test" } })).status, 401, "dev header is ignored in production");
  });

  let adminCookie;
  await t.test("redirects to Google with PKCE, state, nonce and the NMU domain hint", async () => {
    const { location, callback } = await signIn(claims("admin@nmu.test"));
    assert.equal(location.origin + location.pathname, `${googleUrl}/auth`);
    assert.equal(location.searchParams.get("client_id"), CLIENT_ID);
    assert.equal(location.searchParams.get("redirect_uri"), "https://nmu.example/auth/google/callback");
    assert.equal(location.searchParams.get("hd"), "nmu.test");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.ok(location.searchParams.get("state").length >= 32);
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), "/");
    const setCookies = cookiesFrom(callback);
    const session = setCookies.find((item) => item.startsWith("nmu_session="));
    assert.match(session, /HttpOnly/);
    assert.match(session, /Secure/);
    assert.match(session, /SameSite=Lax/);
    assert.match(session, /^nmu_session=[\w-]+\.[\w-]+;/, "signed payload.signature value");
    adminCookie = cookiePair(setCookies, "nmu_session");
    assert.equal(tokenRequests.at(-1).redirect_uri, "https://nmu.example/auth/google/callback");
  });

  await t.test("uses the Airtable Users.Rights role for the signed-in email", async () => {
    const bootstrap = await fetch(`${app.url}/api/bootstrap`, { headers: { cookie: adminCookie } });
    assert.equal(bootstrap.status, 200);
    const body = await bootstrap.json();
    assert.equal(body.currentUser.email, "admin@nmu.test");
    assert.equal(body.currentUser.role, "admin");
    assert.ok(!JSON.stringify(body).toLowerCase().includes("password"));
    const contributor = await signIn(claims("casey@nmu.test"));
    const caseyCookie = cookiePair(cookiesFrom(contributor.callback), "nmu_session");
    const casey = await (await fetch(`${app.url}/api/bootstrap`, { headers: { cookie: caseyCookie } })).json();
    assert.equal(casey.currentUser.role, "contributor");
    airtable.record("Users", "recCasey").fields.Rights = null;
    assert.equal((await fetch(`${app.url}/api/bootstrap`, { headers: { cookie: caseyCookie } })).status, 401, "removing Rights in Airtable revokes access");
    airtable.record("Users", "recCasey").fields.Rights = "Contributor";
  });

  await t.test("rejects non-NMU, unverified, unregistered and rights-less accounts", async () => {
    const outside = await signIn(claims("outsider@gmail.com", { hd: undefined }));
    assert.equal(outside.callback.headers.get("location"), "/?auth_error=domain");
    const spoofedHd = await signIn(claims("outsider@gmail.com", { hd: "nmu.test" }));
    assert.equal(spoofedHd.callback.headers.get("location"), "/?auth_error=domain");
    const unverified = await signIn(claims("admin@nmu.test", { email_verified: false }));
    assert.equal(unverified.callback.headers.get("location"), "/?auth_error=domain");
    const unregistered = await signIn(claims("stranger@nmu.test"));
    assert.equal(unregistered.callback.headers.get("location"), "/?auth_error=not_registered");
    const noRights = await signIn(claims("norights@nmu.test"));
    assert.equal(noRights.callback.headers.get("location"), "/?auth_error=not_registered");
    for (const response of [outside, unverified, unregistered, noRights]) {
      assert.equal(cookiePair(cookiesFrom(response.callback), "nmu_session"), "");
    }
  });

  await t.test("rejects forged state, bad signatures, wrong audience, replayed nonce and expired tokens", async () => {
    const forged = await signIn(claims("admin@nmu.test"), { tamperState: true });
    assert.equal(forged.callback.headers.get("location"), "/?auth_error=state");
    const wrongKey = await signIn(claims("admin@nmu.test"), { token: (value) => idToken(value, { key: otherKey.privateKey }) });
    assert.equal(wrongKey.callback.headers.get("location"), "/?auth_error=google");
    const wrongAudience = await signIn(claims("admin@nmu.test", { aud: "someone-else" }));
    assert.equal(wrongAudience.callback.headers.get("location"), "/?auth_error=google");
    const wrongNonce = await signIn(({ nonce }) => claims("admin@nmu.test")({ nonce: `${nonce}x` }));
    assert.equal(wrongNonce.callback.headers.get("location"), "/?auth_error=google");
    const expired = await signIn(claims("admin@nmu.test", { exp: Math.floor(Date.now() / 1000) - 3600 }));
    assert.equal(expired.callback.headers.get("location"), "/?auth_error=google");
    const noCookie = await fetch(`${app.url}/auth/google/callback?code=x&state=y`, { redirect: "manual" });
    assert.equal(noCookie.headers.get("location"), "/?auth_error=state");
  });

  await t.test("rejects tampered or expired session cookies and signs out", async () => {
    const [name, value] = adminCookie.split("=");
    const tampered = `${name}=${value.slice(0, -2)}xx`;
    assert.equal((await fetch(`${app.url}/api/bootstrap`, { headers: { cookie: tampered } })).status, 401);
    const expired = signValue({ email: "admin@nmu.test", exp: Math.floor(Date.now() / 1000) - 1 }, SESSION_SECRET);
    assert.equal((await fetch(`${app.url}/api/bootstrap`, { headers: { cookie: `nmu_session=${encodeURIComponent(expired)}` } })).status, 401);
    const crossSite = await fetch(`${app.url}/api/auth/logout`, { method: "POST", headers: { cookie: adminCookie, origin: "https://attacker.example" } });
    assert.equal(crossSite.status, 403);
    const logout = await fetch(`${app.url}/api/auth/logout`, { method: "POST", headers: { cookie: adminCookie, origin: app.url } });
    assert.equal(logout.status, 200);
    assert.match(cookiesFrom(logout).find((item) => item.startsWith("nmu_session=")), /Max-Age=0/);
    const write = await fetch(`${app.url}/api/tasks/recWorkRecruit/status`, {
      method: "PATCH", headers: { cookie: adminCookie, "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ status: "Completed" })
    });
    assert.equal(write.status, 403, "cross-origin writes are refused");
  });
});

test("refuses dev mode in production and reports missing Google configuration", async () => {
  const devInProduction = await startApp({ NODE_ENV: "production", NMU_AUTH_MODE: "dev" });
  await new Promise((resolve) => (devInProduction.child.exitCode !== null ? resolve() : devInProduction.child.once("exit", resolve)));
  assert.equal(devInProduction.child.exitCode, 1);
  assert.match(devInProduction.output(), /NMU_AUTH_MODE=dev is not allowed/);

  const unconfigured = await startApp({ NODE_ENV: "production" });
  try {
    const config = await (await fetch(`${unconfigured.url}/api/auth/config`)).json();
    assert.equal(config.googleConfigured, false);
    assert.deepEqual(config.missingConfiguration, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NMU_PUBLIC_URL", "NMU_ALLOWED_EMAIL_DOMAIN", "NMU_SESSION_SECRET (32+ characters)"]);
    const login = await fetch(`${unconfigured.url}/auth/google/login`, { redirect: "manual" });
    assert.equal(login.headers.get("location"), "/?auth_error=not_configured");
  } finally {
    await unconfigured.stop();
  }
});

test("session signing and domain helpers", () => {
  const token = signValue({ email: "a@nmu.test", exp: 2_000_000_000 }, "secret-one");
  assert.equal(verifySignedValue(token, "secret-one", 1_000).email, "a@nmu.test");
  assert.equal(verifySignedValue(token, "secret-two", 1_000), null);
  assert.equal(verifySignedValue(token, "secret-one", 2_000_000_001), null);
  assert.equal(emailInDomain("a@nmu.test", "nmu.test"), true);
  assert.equal(emailInDomain("a@evil-nmu.test", "nmu.test"), false);
  assert.equal(emailInDomain("a@nmu.test.evil.com", "nmu.test"), false);
  assert.equal(emailInDomain("a@b@nmu.test", "nmu.test"), false);
  assert.equal(emailInDomain("a@nmu.test", ""), false);
});
