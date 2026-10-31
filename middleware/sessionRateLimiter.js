import rateLimit from "express-rate-limit";
import { RedisRateLimitStore } from "./redisRateLimitStore.js";

export const sessionMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: new RedisRateLimitStore({ prefix: "session-mutations" }),
  message: { message: "Too many session changes. Try again later." },
});

export const authenticationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: new RedisRateLimitStore({ prefix: "authentication" }),
  message: { message: "Too many authentication attempts. Try again later." },
});

export const emailChallengeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: new RedisRateLimitStore({ prefix: "email-challenges" }),
  message: { message: "Too many email requests. Try again later." },
});

