import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { closeRedis, isRedisCacheAvailable, redisClient } from "../config/redis.js";
import { responseCache, invalidateUserCacheFor } from "../middleware/responseCache.js";
import { RedisRateLimitStore } from "../middleware/redisRateLimitStore.js";

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

test("live Redis supports cached reads, invalidation, TTL, and shared rate limits", {
  skip: !process.env.REDIS_TEST_URL,
}, async (t) => {
  assert.ok(redisClient, "REDIS_URL must be configured for this test");
  const deadline = Date.now() + 8000;
  while (!isRedisCacheAvailable() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(isRedisCacheAvailable(), true, "Redis did not become ready in time");

  const suffix = randomUUID();
  const userId = `redis-live-${suffix}`;
  const cache = responseCache({ namespace: `redis-live:${suffix}`, ttlSeconds: 1 });
  let databaseReads = 0;
  const request = async (url = "/private?second=2&first=1") => {
    const req = { method: "GET", originalUrl: url, url, user: { _id: userId } };
    const res = new MockResponse();
    await cache(req, res, () => {
      databaseReads += 1;
      res.json({ databaseReads });
    });
    return res;
  };

  const first = await request();
  assert.equal(first.headers.get("x-cache"), "MISS");
  const hit = await request("/private?first=1&second=2");
  assert.equal(hit.headers.get("x-cache"), "HIT");
  assert.equal(hit.body.databaseReads, 1);

  await invalidateUserCacheFor(userId);
  const invalidated = await request();
  assert.equal(invalidated.headers.get("x-cache"), "MISS");
  assert.equal(invalidated.body.databaseReads, 2);

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const expired = await request();
  assert.equal(expired.headers.get("x-cache"), "MISS");
  assert.equal(expired.body.databaseReads, 3);

  const firstStore = new RedisRateLimitStore({ prefix: `redis-live:${suffix}` });
  const secondStore = new RedisRateLimitStore({ prefix: `redis-live:${suffix}` });
  firstStore.init({ windowMs: 5000 });
  secondStore.init({ windowMs: 5000 });
  t.after(async () => {
    firstStore.shutdown();
    secondStore.shutdown();
    await redisClient.del(`fixlab:cache:user:${userId}:version`);
    await closeRedis();
  });
  assert.equal((await firstStore.increment(suffix)).totalHits, 1);
  assert.equal((await secondStore.increment(suffix)).totalHits, 2);
  await firstStore.resetKey(suffix);
});
