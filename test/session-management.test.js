import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { requireAuth } from "../middleware/authMiddleware.js";
import { logoutSession } from "../controllers/auth.controller.js";
import User from "../models/User.js";
import Session from "../models/Session.js";
import {
  buildSessionResponse,
  describeUserAgent,
  getReliableClientIp,
  revokeOtherSessions,
  revokeOwnedSession,
} from "../utils/session-management.js";

test("buildSessionResponse marks current session only from validated session identifier", () => {
  const currentId = "550e8400-e29b-41d4-a716-446655440000";
  const response = buildSessionResponse({
    _id: "mongo-id",
    sessionId: currentId,
    ip: "127.0.0.1",
    userAgent: "unknown malformed ua",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    lastActive: new Date("2025-01-02T00:00:00.000Z"),
  }, currentId);

  assert.equal(response.isCurrent, true);
  assert.equal(response.ip, "Unavailable");
  assert.equal(response.location, "Unavailable");
  assert.equal(response.deviceType, "Unknown");
  assert.equal("password" in response, false);
});

test("IP validation rejects loopback, malformed, and private addresses", () => {
  assert.equal(getReliableClientIp("127.0.0.1"), null);
  assert.equal(getReliableClientIp("10.0.0.2"), null);
  assert.equal(getReliableClientIp("not-an-ip"), null);
  assert.equal(getReliableClientIp("203.0.113.10"), null);
  assert.equal(getReliableClientIp("8.8.8.8"), "8.8.8.8");
});

test("unknown User-Agent values receive readable fallback labels", () => {
  const parsed = describeUserAgent("");
  assert.equal(parsed.browser, "Unknown browser on Unknown platform");
  assert.equal(parsed.deviceType, "Unknown");
});

test("individual session revocation scopes deletion to both owner and session id", async () => {
  let query;
  const Session = {
    findOneAndDelete(value) {
      query = value;
      return Promise.resolve({ sessionId: value.sessionId });
    },
  };

  await revokeOwnedSession(Session, "owner-1", "session-1");
  assert.deepEqual(query, { sessionId: "session-1", user: "owner-1" });
});

test("logout controller cannot delete a session unless it belongs to the caller", async (t) => {
  let query;
  t.mock.method(Session, "findOneAndDelete", async (filter) => {
    query = filter;
    return null;
  });
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await logoutSession({
    params: { sessionId: "550e8400-e29b-41d4-a716-446655440000" },
    user: { _id: "caller-user" },
    sessionId: "550e8400-e29b-41d4-a716-446655440001",
  }, response);

  assert.deepEqual(query, {
    sessionId: "550e8400-e29b-41d4-a716-446655440000",
    user: "caller-user",
  });
  assert.equal(response.statusCode, 404);
});

test("authentication middleware rejects a revoked session before protected access", async (t) => {
  process.env.JWT_SECRET = "test-only-secret";
  t.mock.method(Session, "findOneAndUpdate", async () => null);
  const token = jwt.sign({ id: "caller-user", sessionId: "revoked-session" }, process.env.JWT_SECRET);
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;

  await requireAuth({ cookies: { token } }, response, () => { nextCalled = true; });

  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("authentication middleware binds active session to its JWT user", async (t) => {
  process.env.JWT_SECRET = "test-only-secret";
  let sessionQuery;
  let userQuery;
  const activeSession = { sessionId: "active-session" };
  const user = { _id: "caller-user" };
  t.mock.method(Session, "findOneAndUpdate", async (query) => {
    sessionQuery = query;
    return activeSession;
  });
  t.mock.method(User, "findById", (id) => {
    userQuery = id;
    return { select: async () => user };
  });
  const token = jwt.sign({ id: "caller-user", sessionId: "active-session" }, process.env.JWT_SECRET);
  const request = { cookies: { token } };
  let nextCalled = false;

  await requireAuth(request, { status() { return this; }, json() {} }, () => { nextCalled = true; });

  assert.deepEqual(sessionQuery, { sessionId: "active-session", user: "caller-user" });
  assert.equal(userQuery, "caller-user");
  assert.equal(request.sessionId, "active-session");
  assert.equal(request.user, user);
  assert.equal(nextCalled, true);
});

test("revoking other sessions preserves the current user's session", async () => {
  let query;
  const Session = {
    deleteMany(value) {
      query = value;
      return Promise.resolve({ deletedCount: 2 });
    },
  };

  await revokeOtherSessions(Session, "owner-1", "current-session");
  assert.deepEqual(query, { user: "owner-1", sessionId: { $ne: "current-session" } });
});