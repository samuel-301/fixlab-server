import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Session from "../models/Session.js";
import LoginEvent from "../models/LoginEvent.js";
import SecurityNotification from "../models/SecurityNotification.js";
import NotificationPreference from "../models/NotificationPreference.js";
import { initializeAdmin, validateAdminConfiguration } from "../services/admin-initialization.js";
import { adminLogin } from "../controllers/auth.controller.js";

const email = "fixlab-admin@example.com";
const password = "safe-admin-password";
const env = async () => ({ ADMIN_EMAIL: ` ${email.toUpperCase()} `, ADMIN_PASSWORD_HASH: await bcrypt.hash(password, 4) });
const response = () => ({ cookies: {}, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, cookie(name, value) { this.cookies[name] = value; return this; } });

test("admin initialization creates one bcrypt-backed admin and repeated startup is idempotent", async (t) => {
  const config = await env();
  let stored = null;
  let creates = 0;
  t.mock.method(User, "findOne", async () => stored);
  t.mock.method(User, "create", async (data) => { creates += 1; stored = { ...data, _id: "admin-1" }; return stored; });

  assert.equal((await initializeAdmin(config)).created, true);
  assert.equal(stored.normalizedEmail, email);
  assert.equal(stored.role, "admin");
  assert.equal(await bcrypt.compare(password, stored.password), true);
  assert.equal((await initializeAdmin(config)).created, false);
  assert.equal(creates, 1);
});

test("invalid admin configuration fails without disclosing its value", async () => {
  assert.throws(() => validateAdminConfiguration({ ADMIN_EMAIL: "bad", ADMIN_PASSWORD_HASH: "secret" }), /ADMIN_EMAIL/);
  assert.throws(() => validateAdminConfiguration({ ADMIN_EMAIL: email, ADMIN_PASSWORD_HASH: "secret" }), /bcrypt hash/);
});

test("admin initialization refuses to promote an ordinary account", async (t) => {
  t.mock.method(User, "findOne", async () => ({ role: "user" }));
  await assert.rejects(initializeAdmin(await env()), /non-admin account/);
});

test("admin login verifies the database bcrypt password and creates the standard session", async (t) => {
  process.env.JWT_SECRET = "test-only-secret";
  Object.assign(process.env, await env());
  const user = { _id: "admin-1", role: "admin", password: await bcrypt.hash(password, 4) };
  t.mock.method(User, "findOne", async () => user);
  t.mock.method(Session, "exists", async () => false);
  t.mock.method(Session.prototype, "save", async function save() { return this; });
  t.mock.method(LoginEvent, "create", async (value) => value);
  t.mock.method(SecurityNotification, "create", async (value) => value);
  t.mock.method(NotificationPreference, "findOne", () => ({ lean: async () => ({ emailLoginAlerts: false, pushEnabled: false }) }));

  const res = response();
  await adminLogin({ body: { email, password }, ip: "127.0.0.1", get: () => "test-agent" }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { message: "Logged in", role: "admin" });
  assert.ok(res.cookies.token);
});
