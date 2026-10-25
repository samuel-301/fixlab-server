import { isIP } from "node:net";
import geoip from "geoip-lite";

const cache = new Map();
const CACHE_TTL_MS = Math.max(60_000, Number(process.env.GEOIP_CACHE_TTL_MS) || 6 * 60 * 60 * 1000);
const MAX_CACHE_SIZE = 5000;

export const normalizeIp = (value) => {
  if (typeof value !== "string") return null;
  let ip = value.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (ip.toLowerCase().startsWith("::ffff:")) {
    const mapped = ip.slice(7);
    if (isIP(mapped) === 4) ip = mapped;
  }
  return isIP(ip) ? ip.toLowerCase() : null;
};

// Use Express's already-resolved req.ip; do not parse arbitrary X-Forwarded-For
// values here because proxy trust must be configured at the Express boundary.
export const getReliableClientIp = (value) => normalizeIp(value);

const ipv4Number = (ip) => ip.split(".").reduce((n, octet) => (n * 256) + Number(octet), 0);
const inV4Range = (ip, base, bits) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(ip) & mask) === (ipv4Number(base) & mask);
};

export const isPublicIp = (value) => {
  const ip = normalizeIp(value);
  if (!ip) return false;
  if (isIP(ip) === 4) {
    const blocked = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
      ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
      ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return !blocked.some(([base, bits]) => inV4Range(ip, base, bits));
  }
  const lower = ip.toLowerCase();
  return !(lower === "::" || lower === "::1" ||
    lower.startsWith("fc") || lower.startsWith("fd") ||
    /^fe[89ab]/.test(lower) || lower.startsWith("2001:db8:") ||
    lower.startsWith("2001:10:") || lower.startsWith("ff"));
};

const emptyLocation = (ip, source = "unavailable") => ({
  ip: ip || null, country: null, countryCode: null, region: null, city: null,
  timezone: null, latitude: null, longitude: null, source,
});

const logDiagnostic = (status) => {
  console.info("[geoip]", { status });
};

export const formatLocation = (location) => {
  if (!location) return "Location unavailable";
  const parts = [location.city, location.region, location.country].filter(Boolean);
  return parts.length ? parts.join(", ") : location.country || "Location unavailable";
};

export const resolveClientLocation = (value) => {
  const ip = normalizeIp(value);
  if (!ip) {
    logDiagnostic("invalid_or_missing_ip");
    return emptyLocation(null, "unavailable");
  }
  if (!isPublicIp(ip)) {
    logDiagnostic("private_or_reserved_ip");
    return emptyLocation(null, "unavailable");
  }

  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value };
  try {
    const result = geoip.lookup(ip);
    if (!result || typeof result !== "object") {
      logDiagnostic("ip_not_found");
      const value = emptyLocation(ip, "geoip-lite");
      cacheValue(ip, value);
      return value;
    }
    const [latitude, longitude] = Array.isArray(result.ll) ? result.ll : [];
    const location = {
      ip,
      country: typeof result.country === "string" ? result.country : null,
      countryCode: typeof result.country === "string" ? result.country : null,
      region: typeof result.region === "string" && result.region ? result.region : null,
      city: typeof result.city === "string" && result.city ? result.city : null,
      timezone: typeof result.timezone === "string" && result.timezone ? result.timezone : null,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      source: "geoip-lite",
    };
    logDiagnostic(location.city ? "city_lookup_success" : location.country ? "country_lookup_success" : "ip_not_found");
    cacheValue(ip, location);
    return location;
  } catch {
    logDiagnostic("provider_unavailable");
    return emptyLocation(ip, "unavailable");
  }
};

const cacheValue = (ip, value) => {
  if (cache.size >= MAX_CACHE_SIZE) cache.delete(cache.keys().next().value);
  cache.set(ip, { value: { ...value }, expiresAt: Date.now() + CACHE_TTL_MS });
};

export const clearGeoIpCacheForTests = () => cache.clear();
