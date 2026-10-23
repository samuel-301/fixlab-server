import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { responseCache, invalidateUserCacheFor, createUserCacheInvalidator } from "../middleware/responseCache.js";
import { RedisRateLimitStore } from "../middleware/redisRateLimitStore.js";

class FakeRedis {
  constructor() {
    this.values = new Map();
    this.clock = 0;
    this.fail = false;
  }

  entry(key) {
    const value = this.values.get(key);
    if (value?.expiresAt && value.expiresAt <= this.clock) {
      this.values.delete(key);
      return null;
    }
    return value || null;
  }

  async get(key) {
    if (this.fail) throw new Error("Redis unavailable");
    return this.entry(key)?.value ?? null;
  }

  async mGet(keys) {
    if (this.fail) throw new Error("Redis unavailable");
    return keys.map((key) => this.entry(key)?.value ?? null);
  }

  async set(key, value, options = {}) {
    if (this.fail) throw new Error("Redis unavailable");
    if (options.NX && this.entry(key)) return null;
    const ttl = options.EX ? options.EX * 1000 : options.PX;
    this.values.set(key, { value: String(value), expiresAt: ttl ? this.clock + ttl : null });
    return "OK";
  }

  async incr(key) {
    if (this.fail) throw new Error("Redis unavailable");
    const next = Number(this.entry(key)?.value || 0) + 1;
    this.values.set(key, { value: String(next), expiresAt: null });
    return next;
  }

  async del(key) {
    if (this.fail) throw new Error("Redis unavailable");
    return Number(this.values.delete(key));
  }

  async eval(script, { keys, arguments: args }) {
    if (this.fail) throw new Error("Redis unavailable");
    const [key] = keys;
    const entry = this.entry(key);
    if (script.includes("local count = redis.call('INCR'")) {
      const count = Number(entry?.value || 0) + 1;
      const ttl = entry ? entry.expiresAt - this.clock : Number(args[0]);
      this.values.set(key, { value: String(count), expiresAt: this.clock + ttl });
      return [count, ttl];
    }
    if (script.includes("redis.call('DECR'")) {
      const count = Number(entry?.value || 0) - 1;
      if (count <= 0) this.values.delete(key);
      else this.values.set(key, { ...entry, value: String(count) });
      return count;
    }
    if (entry?.value === args[0]) return this.del(key);
    return 0;
  }

  advance(milliseconds) {
    this.clock += milliseconds;
  }
}

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = new Map();
    this.json = this.json.bind(this);
  }

  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), value);
  }

  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  }

  json(body) {
    this.body = body;
    this.emit("finish");
    return this;
  }
}

const runCachedRequest = async (middleware, userId, handleMiss) => {
  const req = {
    method: "GET",
    originalUrl: "/private/items",
    url: "/private/items",
    user: userId ? { _id: userId } : undefined,
  };
  const res = new MockResponse();
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return res;
  }
  await middleware(req, res, () => handleMiss(res));
  return res;
};

test("private response cache enforces authorization, isolates users, invalidates writes, and expires", async () => {
  const redis = new FakeRedis();
  let databaseReads = 0;
  const cache = responseCache({ namespace: "test:items", ttlSeconds: 1, client: redis, isReady: () => true });
  const request = (userId) => runCachedRequest(cache, userId, (res) => {
    databaseReads += 1;
    res.json({ databaseReads });
  });

  const unauthorized = await request();
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.headers.get("x-cache"), undefined);

  const first = await request("user-a");
  assert.equal(first.body.databaseReads, 1);
  const hit = await request("user-a");
  assert.equal(hit.headers.get("x-cache"), "HIT");
  assert.equal(hit.body.databaseReads, 1);

  const otherUser = await request("user-b");
  assert.equal(otherUser.headers.get("x-cache"), "MISS");
  assert.equal(otherUser.body.databaseReads, 2);

  await invalidateUserCacheFor("user-a", redis, () => true);
  const invalidated = await request("user-a");
  assert.equal(invalidated.headers.get("x-cache"), "MISS");
  assert.equal(invalidated.body.databaseReads, 3);

  redis.advance(1001);
  const expired = await request("user-a");
  assert.equal(expired.headers.get("x-cache"), "MISS");
  assert.equal(expired.body.databaseReads, 4);
});

test("two rate-limit stores share atomic counts and retain a local fallback during outages", async () => {
  const redis = new FakeRedis();
  const first = new RedisRateLimitStore({ prefix: "test", client: redis, isReady: () => true });
  const second = new RedisRateLimitStore({ prefix: "test", client: redis, isReady: () => true });
  first.init({ windowMs: 1000 });
  second.init({ windowMs: 1000 });
  assert.equal((await first.increment("same-client")).totalHits, 1);
  assert.equal((await second.increment("same-client")).totalHits, 2);
  first.shutdown();
  second.shutdown();

  redis.fail = true;
  const fallback = new RedisRateLimitStore({ prefix: "outage", client: redis, isReady: () => true });
  fallback.init({ windowMs: 1000 });
  assert.equal((await fallback.increment("client")).totalHits, 1);
  assert.equal((await fallback.increment("client")).totalHits, 2);
  fallback.shutdown();
});

test("successful writes invalidate before and after the database update", async () => {
  const redis = new FakeRedis();
  const invalidate = createUserCacheInvalidator({ client: redis, isReady: () => true });
  const req = { method: "PUT", user: { _id: "user-a" } };
  const res = new MockResponse();

  await invalidate(req, res, () => res.status(200).json({ updated: true }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(await redis.get("fixlab:cache:user:user-a:version"), "2");
  assert.deepEqual(res.body, { updated: true });
});

test("cache bypasses Redis failures and continues to the database", async () => {
  const redis = new FakeRedis();
  redis.fail = true;
  let databaseReads = 0;
  const cache = responseCache({ namespace: "test:outage", client: redis, isReady: () => true });
  const response = await runCachedRequest(cache, "user-a", (res) => {
    databaseReads += 1;
    res.json({ databaseReads });
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.databaseReads, 1);
});

test("concurrent reads coalesce in process during a Redis outage", async () => {
  const redis = new FakeRedis();
  redis.fail = true;
  let databaseReads = 0;
  const cache = responseCache({ namespace: "test:coalesce", client: redis, isReady: () => true });
  const read = () => runCachedRequest(cache, "user-a", (res) => {
    databaseReads += 1;
    setTimeout(() => res.json({ databaseReads }), 25);
  });

  const first = read();
  await new Promise((resolve) => setTimeout(resolve, 1));
  const second = read();
  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.equal(databaseReads, 1);
  assert.deepEqual(firstResponse.body, { databaseReads: 1 });
  assert.deepEqual(secondResponse.body, { databaseReads: 1 });
  assert.equal(secondResponse.headers.get("x-cache"), "HIT-LOCAL");
});

test("error responses are never cached", async () => {
  const redis = new FakeRedis();
  let attempts = 0;
  const cache = responseCache({ namespace: "test:errors", client: redis, isReady: () => true });
  const request = () => runCachedRequest(cache, "user-a", (res) => {
    attempts += 1;
    res.status(attempts === 1 ? 500 : 200).json({ attempts });
  });

  const failure = await request();
  const success = await request();
  assert.equal(failure.statusCode, 500);
  assert.equal(success.headers.get("x-cache"), "MISS");
  assert.equal(success.body.attempts, 2);
});
