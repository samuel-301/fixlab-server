import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
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

test("Google login creates a session only after Google verifies the ID token", async (t) => {
  process.env.JWT_SECRET = "test-only-secret";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  const user = { _id: "google-user", username: "person", email: "person@example.com", emailVerified: true };
  t.mock.method(OAuth2Client.prototype, "verifyIdToken", async () => ({ getPayload: () => ({
    iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 60,
    email_verified: true, sub: "google-sub", email: user.email,
  }) }));
  t.mock.method(User, "findOne", async () => user);
  prepareSessionMocks(t);
  const res = response();
  await googleLogin({ body: { credential: "valid-google-id-token" }, ip: "127.0.0.1", get: () => "test-agent" }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.cookies.token);
});

test("Google login does not create a session for a rejected ID token", async (t) => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  t.mock.method(OAuth2Client.prototype, "verifyIdToken", async () => { throw new Error("invalid token"); });
  const save = t.mock.method(Session.prototype, "save", async function save() { return this; });
  const res = response();
  await googleLogin({ body: { credential: "invalid-google-id-token" }, ip: "127.0.0.1", get: () => "test-agent" }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(save.mock.callCount(), 0);
  assert.equal(res.cookies.token, undefined);
});
