import { createHash, randomUUID } from "node:crypto";
import { isRedisCacheAvailable, redisClient, withRedisTimeout } from "../config/redis.js";
import { recordCacheLatency, recordMetric } from "../utils/operationalMetrics.js";

const cachePrefix = "fixlab:cache:response:";
const userVersionKey = (userId) => `fixlab:cache:user:${userId}:version`;
const releaseLockScript = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
const localInFlight = new Map();
const localUserVersions = new Map();

const bumpLocalUserVersion = (userId) => {
  const nextVersion = (localUserVersions.get(userId) || 0) + 1;
  localUserVersions.delete(userId);
  localUserVersions.set(userId, nextVersion);
  while (localUserVersions.size > 10_000) {
    localUserVersions.delete(localUserVersions.keys().next().value);
  }
};

export const cacheTtl = (category, fallbackSeconds) => {
  const configured = Number(process.env[`REDIS_CACHE_TTL_${category}`] || process.env.REDIS_DEFAULT_TTL);
  const value = Number.isFinite(configured) && configured > 0 ? configured : fallbackSeconds;
  return Math.min(Math.max(Math.floor(value), 1), 3600);
};

const normalizedUrl = (value) => {
  const url = new URL(value, "http://cache.local");
  const params = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  const query = new URLSearchParams(params).toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
};

const makeCacheKey = ({ namespace, userId, epoch, version, url }) => {
  const digest = createHash("sha256").update(`${namespace}\0${userId}\0${epoch}\0${version}\0${url}`).digest("hex");
  return `${cachePrefix}${digest}`;
};

const readCacheEntry = async (client, key) => {
  const value = await withRedisTimeout(client.get(key));
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    recordMetric("cacheErrors");
    return null;
  }
};

export const responseCache = ({ namespace, ttlSeconds = 30, client = redisClient, isReady = isRedisCacheAvailable } = {}) =>
  async (req, res, next) => {
    if (req.method !== "GET" || !req.user?._id) {
      return next();
    }

    const userId = String(req.user._id);
    const url = normalizedUrl(req.originalUrl || req.url || req.path);
    const localKey = createHash("sha256")
      .update(`${namespace}\0${userId}\0${localUserVersions.get(userId) || 0}\0${url}`)
      .digest("hex");
    const existingFlight = localInFlight.get(localKey);
    if (existingFlight) {
      const shared = await existingFlight.promise;
      if (shared) {
        recordMetric("cacheHits");
        res.setHeader("X-Cache", "HIT-LOCAL");
        res.setHeader("Cache-Control", "private, no-store");
        return res.status(shared.statusCode).json(shared.body);
      }
      recordMetric("cacheBypasses");
      return next();
    }

    let resolveFlight;
    const flight = {
      promise: new Promise((resolve) => { resolveFlight = resolve; }),
      resolved: false,
      userId,
    };
    const finishFlight = (result) => {
      if (flight.resolved) return;
      flight.resolved = true;
      resolveFlight(result);
    };
    localInFlight.set(localKey, flight);
    const flightTimer = setTimeout(() => {
      finishFlight(null);
      if (localInFlight.get(localKey) === flight) localInFlight.delete(localKey);
    }, 5000);
    flightTimer.unref?.();
    const cleanupFlight = () => {
      clearTimeout(flightTimer);
      finishFlight(null);
      if (localInFlight.get(localKey) === flight) localInFlight.delete(localKey);
    };
    res.once("finish", cleanupFlight);
    res.once("close", cleanupFlight);
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      finishFlight(res.statusCode >= 200 && res.statusCode < 300 ? { statusCode: res.statusCode, body } : null);
      return sendJson(body);
    };

    if (!client || !isReady()) {
      recordMetric("cacheBypasses");
      return next();
    }

    const startedAt = process.hrtime.bigint();
    const recordLatency = () => recordCacheLatency(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
    let lockKey;
    let lockToken;
    try {
      const [epochValue, versionValue] = await withRedisTimeout(client.mGet([
        "fixlab:cache:epoch",
        userVersionKey(userId),
      ]));
      const key = makeCacheKey({
        namespace,
        userId,
        epoch: epochValue || "0",
        version: versionValue || "0",
        url,
      });
      const cached = await readCacheEntry(client, key);
      if (cached && Number.isInteger(cached.statusCode) && cached.body !== undefined) {
        recordMetric("cacheHits");
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Cache-Control", "private, no-store");
        recordLatency();
        return res.status(cached.statusCode).json(cached.body);
      }

      recordMetric("cacheMisses");
      lockKey = `${key}:lock`;
      lockToken = randomUUID();
      const acquired = await withRedisTimeout(client.set(lockKey, lockToken, { NX: true, PX: 3000 }));
      if (!acquired) {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 35));
          const shared = await readCacheEntry(client, key);
          if (shared && Number.isInteger(shared.statusCode) && shared.body !== undefined) {
            recordMetric("cacheHits");
            res.setHeader("X-Cache", "HIT");
            res.setHeader("Cache-Control", "private, no-store");
            recordLatency();
            return res.status(shared.statusCode).json(shared.body);
          }
        }
        lockKey = null;
        lockToken = null;
      } else {
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          void withRedisTimeout(client.eval(releaseLockScript, { keys: [lockKey], arguments: [lockToken] })).catch(() => {});
        };
        res.once("finish", release);
        res.once("close", release);
        const sendJson = res.json.bind(res);
        res.json = (body) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && body !== undefined) {
            const payload = JSON.stringify({ statusCode: res.statusCode, body });
            if (payload !== undefined) {
              void withRedisTimeout(client.set(key, payload, { EX: ttlSeconds }))
                .then(() => recordMetric("cacheWrites"))
                .catch(() => recordMetric("cacheErrors"));
            }
          }
          return sendJson(body);
        };
      }

      res.setHeader("X-Cache", "MISS");
      res.setHeader("Cache-Control", "private, no-store");
      recordLatency();
      return next();
    } catch {
      recordMetric("cacheErrors");
      recordMetric("cacheBypasses");
      recordLatency();
      return next();
    }
  };

export const createUserCacheInvalidator = ({ client = redisClient, isReady = isRedisCacheAvailable } = {}) =>
  async (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.user?._id) return next();
    const userId = String(req.user._id);
    bumpLocalUserVersion(userId);
    if (client && isReady()) await invalidateUserCacheFor(userId, client, isReady);
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        bumpLocalUserVersion(userId);
        if (client && isReady()) {
          void invalidateUserCacheFor(userId, client, isReady).finally(() => sendJson(body));
        } else {
          sendJson(body);
        }
        return res;
      }
      return sendJson(body);
    };
    return next();
  };

export const invalidateUserCache = createUserCacheInvalidator();

export const invalidateUserCacheFor = async (userId, client = redisClient, isReady = isRedisCacheAvailable) => {
  if (!userId || !client || !isReady()) return false;
  try {
    await withRedisTimeout(client.incr(userVersionKey(String(userId))));
    recordMetric("cacheInvalidations");
    return true;
  } catch {
    recordMetric("cacheErrors");
    return false;
  }
};
