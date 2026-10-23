import { createHash } from "node:crypto";
import { MemoryStore } from "express-rate-limit";
import { isRedisAvailable, redisClient, withRedisTimeout } from "../config/redis.js";
import { recordMetric } from "../utils/operationalMetrics.js";

const incrementScript = "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return {count, redis.call('PTTL', KEYS[1])}";
const decrementScript = "local count = redis.call('DECR', KEYS[1]); if count <= 0 then redis.call('DEL', KEYS[1]); return 0; end; return count";

export class RedisRateLimitStore {
  constructor({ prefix, client = redisClient, isReady = isRedisAvailable } = {}) {
    this.prefix = `fixlab:rate-limit:${prefix || "default"}:`;
    this.client = client;
    this.isReady = isReady;
    this.memory = new MemoryStore();
    this.windowMs = 60_000;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  keyFor(key) {
    const digest = createHash("sha256").update(String(key)).digest("hex");
    return `${this.prefix}${digest}`;
  }

  async increment(key) {
    if (!this.client || !this.isReady()) {
      recordMetric("rateLimitFallbacks");
      return this.memory.increment(key);
    }
    try {
      const [totalHits, ttl] = await withRedisTimeout(this.client.eval(incrementScript, {
        keys: [this.keyFor(key)],
        arguments: [String(this.windowMs)],
      }));
      return { totalHits: Number(totalHits), resetTime: new Date(Date.now() + Math.max(Number(ttl), 0)) };
    } catch {
      recordMetric("rateLimitFallbacks");
      return this.memory.increment(key);
    }
  }

  async decrement(key) {
    if (!this.client || !this.isReady()) return this.memory.decrement(key);
    try {
      await withRedisTimeout(this.client.eval(decrementScript, { keys: [this.keyFor(key)], arguments: [] }));
    } catch {
      recordMetric("rateLimitFallbacks");
      this.memory.decrement(key);
    }
  }

  async resetKey(key) {
    if (!this.client || !this.isReady()) return this.memory.resetKey(key);
    try {
      await withRedisTimeout(this.client.del(this.keyFor(key)));
    } catch {
      recordMetric("rateLimitFallbacks");
      this.memory.resetKey(key);
    }
  }

  shutdown() {
    this.memory.shutdown();
  }
}
