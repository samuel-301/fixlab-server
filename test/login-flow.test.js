import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Session from "../models/Session.js";
import { login, googleLogin } from "../controllers/auth.controller.js";

const response = () => ({ cookies: {}, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, cookie(name, value) { this.cookies[name] = value; return this; } });
const prepareSessionMocks = (t) => {
  t.mock.method(Session, "exists", async () => false);
  t.mock.method(Session.prototype, "save", async function save() { return this; });
};

test("password login creates a session only after valid credentials", async (t) => {
  process.env.JWT_SECRET = "test-only-secret";
  const user = { _id: "user-1", username: "person", email: "person@example.com", password: await bcrypt.hash("valid-password", 4) };
  t.mock.method(User, "findOne", async () => user);
  prepareSessionMocks(t);
  const res = response();
  await login({ body: { username: "person@example.com", password: "valid-password" }, ip: "127.0.0.1", get: () => "test-agent" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.userId, "user-1");
  assert.ok(res.cookies.token);
});

test("password login rejects invalid credentials without creating a session", async (t) => {
  t.mock.method(User, "findOne", async () => null);
  const save = t.mock.method(Session.prototype, "save", async function save() { return this; });
  const res = response();
  await login({ body: { username: "missing@example.com", password: "wrong" }, ip: "127.0.0.1", get: () => "test-agent" }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(res.cookies.token, undefined);
});

test("Google login creates a session only after Google validates the access token and profile", async (t) => {
  process.env.JWT_SECRET = "test-only-secret";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.CLIENT_ORIGINS = "https://fixlab.example";
  const user = { _id: "google-user", username: "person", email: "person@example.com", emailVerified: true };
  t.mock.method(global, "fetch", async (url) => {
    if (String(url).includes("tokeninfo")) {
      return { ok: true, json: async () => ({ aud: "test-client-id", expires_in: "3600", scope: "openid email profile" }) };
    }
    return { ok: true, json: async () => ({ sub: "google-sub", email: user.email, email_verified: true, name: "Person" }) };
  });
  t.mock.method(User, "findOne", async () => user);
  prepareSessionMocks(t);
  const res = response();
  await googleLogin({
    body: { accessToken: "valid-google-access-token" },
    ip: "127.0.0.1",
    get: (name) => name === "origin" ? "https://fixlab.example" : name === "x-requested-with" ? "XmlHttpRequest" : "test-agent",
  }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.cookies.token);
});
test("Google login does not create a session for an invalid access token", async (t) => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.CLIENT_ORIGINS = "https://fixlab.example";
  t.mock.method(global, "fetch", async () => ({ ok: false, json: async () => ({}) }));
  const save = t.mock.method(Session.prototype, "save", async function save() { return this; });
  const res = response();
  await googleLogin({
    body: { accessToken: "invalid-google-access-token" },
    ip: "127.0.0.1",
    get: (name) => name === "origin" ? "https://fixlab.example" : name === "x-requested-with" ? "XmlHttpRequest" : "test-agent",
  }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(res.cookies.token, undefined);
});
