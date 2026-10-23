import { createClient } from "redis";
import { recordMetric } from "../utils/operationalMetrics.js";

const redisEnabled = process.env.REDIS_ENABLED !== "false" && Boolean(process.env.REDIS_URL);
const redisClient = redisEnabled
  ? createClient({
      url: process.env.REDIS_URL,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 1500,
        reconnectStrategy: (retries) => Math.min(retries * 250, 3000),
      },
    })
  : null;

let cacheReady = false;
let redisErrorCount = 0;

if (redisClient) {
  redisClient.on("error", () => {
    cacheReady = false;
    redisErrorCount += 1;
    recordMetric("cacheErrors");
    if (redisErrorCount === 1 || (redisErrorCount & (redisErrorCount - 1)) === 0) {
      console.warn("Redis connection error; using database and local rate-limit fallbacks");
    }
  });
  redisClient.on("reconnecting", () => {
    cacheReady = false;
  });
  redisClient.on("end", () => {
    cacheReady = false;
  });
  redisClient.on("ready", () => {
    cacheReady = false;
    redisClient.incr("fixlab:cache:epoch")
      .then(() => {
        cacheReady = true;
        console.info("Redis connected");
      })
      .catch(() => {
        cacheReady = false;
        recordMetric("cacheErrors");
      });
  });

  void redisClient.connect().catch(() => {
    cacheReady = false;
  });
}

export const isRedisAvailable = () => Boolean(redisClient?.isReady);
export const isRedisCacheAvailable = () => Boolean(redisClient?.isReady && cacheReady);

export const getRedisStatus = () => ({
  enabled: Boolean(redisClient),
  available: isRedisAvailable(),
  cacheAvailable: isRedisCacheAvailable(),
});

export const withRedisTimeout = (operation, timeoutMs = Number(process.env.REDIS_COMMAND_TIMEOUT_MS) || 750) => {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Redis operation timed out")), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
};

export const closeRedis = async () => {
  if (!redisClient?.isOpen) return;
  try {
    await withRedisTimeout(redisClient.quit(), 1500);
  } catch {
    redisClient.destroy();
  }
};

export { redisClient };
