const counters = {
  cacheHits: 0,
  cacheMisses: 0,
  cacheWrites: 0,
  cacheErrors: 0,
  cacheBypasses: 0,
  cacheInvalidations: 0,
  cacheOperations: 0,
  cacheLatencyMsTotal: 0,
  rateLimitFallbacks: 0,
  requests: 0,
  requestLatencyMsTotal: 0,
};

const requestCounts = new Map();

export const recordMetric = (name, amount = 1) => {
  if (Object.hasOwn(counters, name)) counters[name] += amount;
};

export const recordRequest = (method, route, statusCode, durationMs) => {
  counters.requests += 1;
  counters.requestLatencyMsTotal += durationMs;
  const key = `${method} ${route} ${Math.floor(statusCode / 100)}xx`;
  if (requestCounts.size < 100 || requestCounts.has(key)) {
    requestCounts.set(key, (requestCounts.get(key) || 0) + 1);
  }
};

export const recordCacheLatency = (durationMs) => {
  counters.cacheOperations += 1;
  counters.cacheLatencyMsTotal += durationMs;
};

export const getOperationalMetrics = () => ({
  ...counters,
  requestLatencyMsAverage: counters.requests
    ? Math.round((counters.requestLatencyMsTotal / counters.requests) * 100) / 100
    : 0,
  cacheLatencyMsAverage: counters.cacheOperations
    ? Math.round((counters.cacheLatencyMsTotal / counters.cacheOperations) * 100) / 100
    : 0,
  requestsByRoute: Object.fromEntries(requestCounts),
});

export const requestMetricsMiddleware = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const routePath = req.route?.path ? `${req.baseUrl}${req.route.path}` : "unmatched";
    recordRequest(req.method, routePath, res.statusCode, durationMs);
  });
  next();
};
