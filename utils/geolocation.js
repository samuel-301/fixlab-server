import { isIP } from "node:net";
import geoip from "geoip-lite";

const cache = new Map();

const CACHE_TTL_MS = Math.max(60_000, Number(process.env.GEOIP_CACHE_TTL_MS) || 6 * 60 * 60 * 1000);
const MAX_CACHE_SIZE = 5000;
const UNAVAILABLE_LABELS = new Set([
  "location unavailable",
  "unavailable",
  "unknown location",
  "unknown",
]);

const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });

export const normalizeIp = (value) => {
  if (typeof value !== "string") return null;
  let ip = value.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const zoneIndex = ip.indexOf("%");
  if (zoneIndex !== -1) ip = ip.slice(0, zoneIndex);
  if (ip.toLowerCase().startsWith("::ffff:")) {
    const mapped = ip.slice(7);
    if (isIP(mapped) === 4) ip = mapped;
  }
  return isIP(ip) ? ip.toLowerCase() : null;
};

const ipv4Number = (ip) => ip.split(".").reduce((n, octet) => (n * 256) + Number(octet), 0);
const inV4Range = (ip, base, bits) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(ip) & mask) === (ipv4Number(base) & mask);
};

const expandIPv6 = (ip) => {
  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = [...headParts, ...Array(Math.max(0, missing)).fill("0"), ...tailParts];
  return parts.map((part) => part.padStart(4, "0")).join(":");
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
  const full = expandIPv6(ip);
  return !(
    full === "0000:0000:0000:0000:0000:0000:0000:0000"
    || full === "0000:0000:0000:0000:0000:0000:0000:0001"
    || full.startsWith("fc")
    || full.startsWith("fd")
    || /^fe[89ab]/.test(full)
    || full.startsWith("2001:0db8:")
    || full.startsWith("2001:0010:")
    || full.startsWith("0100:0000:0000:0000:")
    || full.startsWith("ff")
  );
};

export const getReliableClientIp = (value) => {
  const ip = normalizeIp(value);
  return ip && isPublicIp(ip) ? ip : null;
};

export const getRequestClientIp = (req) => {
  const raw = req == null || typeof req === "string" || typeof req === "number"
    ? req
    : req.ip;
  const ip = getReliableClientIp(typeof raw === "function" ? undefined : raw);
  if (ip) {
    logDiagnostic("public_ip_resolved");
    return ip;
  }
  logDiagnostic(raw ? "no_public_ip_in_trusted_chain" : "invalid_or_missing_ip");
  return null;
};

const emptyLocation = (ip, source = "unavailable") => ({
  ip: ip || null,
  country: null,
  countryCode: null,
  region: null,
  city: null,
  timezone: null,
  latitude: null,
  longitude: null,
  display: null,
  source,
});

const logDiagnostic = (status) => {
  console.info("[geoip]", { status });
};

const textOrNull = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

export const isPlaceholderLocation = (value) => {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  return UNAVAILABLE_LABELS.has(value.trim().toLowerCase());
};

const countryName = (codeOrName) => {
  const value = textOrNull(codeOrName);
  if (!value) return null;
  if (/^[a-z]{2}$/i.test(value)) {
    try {
      return countryDisplayNames.of(value.toUpperCase()) || value.toUpperCase();
    } catch {
      return value.toUpperCase();
    }
  }
  return value;
};

const regionName = (countryCode, region) => {
  const value = textOrNull(region);
  if (!value) return null;
  if (/^[a-z0-9]{1,3}$/i.test(value) && countryCode && /^[a-z]{2}$/i.test(countryCode)) {
    try {
      const labeled = countryDisplayNames.of(`${countryCode.toUpperCase()}-${value.toUpperCase()}`);
      if (labeled && labeled !== countryName(countryCode)) return labeled;
    } catch {
      return value.toUpperCase();
    }
    return value.toUpperCase();
  }
  return value;
};

export const formatLocation = (location) => {
  if (location == null) return "Location unavailable";
  if (typeof location === "string") {
    return isPlaceholderLocation(location) ? "Location unavailable" : location.trim();
  }
  if (typeof location !== "object") return "Location unavailable";
  if (textOrNull(location.display) && !isPlaceholderLocation(location.display)) {
    return location.display.trim();
  }
  const countryCode = textOrNull(location.countryCode) || textOrNull(location.country);
  const country = countryName(location.country) || countryName(location.countryCode);
  const region = regionName(countryCode, location.region);
  const city = textOrNull(location.city);
  const parts = [city, region && region !== city ? region : null, country].filter(Boolean);
  if (parts.length) {
    return [...new Set(parts)].join(", ");
  }
  return "Location unavailable";
};

const cacheValue = (ip, value) => {
  if (cache.size >= MAX_CACHE_SIZE) cache.delete(cache.keys().next().value);
  cache.set(ip, { value: { ...value }, expiresAt: Date.now() + CACHE_TTL_MS });
};

const lookupGeo = (ip, lookup = geoip.lookup.bind(geoip)) => lookup(ip);

export const resolveClientLocation = (value, lookup) => {
  const ip = getReliableClientIp(value);
  if (!normalizeIp(value)) {
    logDiagnostic("invalid_or_missing_ip");
    return emptyLocation(null, "unavailable");
  }
  if (!ip) {
    logDiagnostic("private_or_reserved_ip");
    return emptyLocation(null, "unavailable");
  }

  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value };

  try {
    const result = lookupGeo(ip, lookup);
    if (!result || typeof result !== "object") {
      logDiagnostic(isIP(ip) === 6 ? "ipv6_not_in_database" : "ip_not_found");
      const missing = emptyLocation(ip, "geoip-lite");
      cacheValue(ip, missing);
      return missing;
    }

    const [latitude, longitude] = Array.isArray(result.ll) ? result.ll : [];
    const countryCode = textOrNull(result.country);
    const location = {
      ip,
      country: countryName(countryCode),
      countryCode: countryCode ? countryCode.toUpperCase() : null,
      region: regionName(countryCode, result.region),
      city: textOrNull(result.city),
      timezone: textOrNull(result.timezone),
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      display: null,
      source: "geoip-lite",
    };
    const display = formatLocation(location);
    location.display = display === "Location unavailable" ? null : display;
    logDiagnostic(
      location.city ? "city_lookup_success"
        : location.region ? "region_lookup_success"
          : location.country ? "country_lookup_success"
            : isIP(ip) === 6 ? "ipv6_not_in_database"
              : "ip_not_found",
    );
    cacheValue(ip, location);
    return location;
  } catch {
    logDiagnostic("provider_unavailable");
    return emptyLocation(ip, "unavailable");
  }
};

export const storedLocationFrom = ({ geolocation, location, ip } = {}) => {
  const saved = geolocation && typeof geolocation === "object" ? geolocation : null;
  if (saved && (saved.city || saved.region || saved.country || saved.countryCode || (saved.display && !isPlaceholderLocation(saved.display)))) {
    const display = formatLocation(saved);
    return { geolocation: { ...emptyLocation(saved.ip || getReliableClientIp(ip), saved.source || "stored"), ...saved, display }, location: display };
  }
  if (!isPlaceholderLocation(location)) {
    return { geolocation: saved || emptyLocation(getReliableClientIp(ip), "stored"), location: String(location).trim() };
  }
  const resolved = resolveClientLocation(ip);
  return { geolocation: resolved, location: formatLocation(resolved) };
};

export const getGeoIpDatabaseStatus = () => {
  try {
    const probe = geoip.lookup("8.8.8.8");
    if (probe && textOrNull(probe.country)) return "ready";
    return "unusable";
  } catch {
    return "unavailable";
  }
};

export const clearGeoIpCacheForTests = () => cache.clear();

const remoteCache = new Map();
const GEOLOCATION_API_TIMEOUT_MS = Math.min(
  8000,
  Math.max(1000, Number(process.env.GEOLOCATION_API_TIMEOUT_MS) || 4000),
);

const lookupRemoteGeo = async (ip) => {
  const cached = remoteCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value };

  const apiKey = process.env.IPGEOLOCATION_API_KEY?.trim();
  if (!apiKey) {
    logDiagnostic("ip2location_api_key_missing");
    return null;
  }

  const url = new URL("https://api.ip2location.io/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("ip", ip);
  url.searchParams.set("format", "json");

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(GEOLOCATION_API_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      logDiagnostic(response.status === 429 ? "ip2location_rate_limited" : "ip2location_http_error");
      return null;
    }

    const data = await response.json();
    const countryCode = textOrNull(data.country_code);
    const location = {
      ip,
      country: countryName(data.country_name) || countryName(countryCode),
      countryCode: countryCode ? countryCode.toUpperCase() : null,
      region: textOrNull(data.region_name),
      city: textOrNull(data.city_name),
      timezone: textOrNull(data.time_zone),
      latitude: Number.isFinite(data.latitude) ? data.latitude : null,
      longitude: Number.isFinite(data.longitude) ? data.longitude : null,
      display: null,
      source: "ip2location.io",
    };
    const display = formatLocation(location);
    location.display = display === "Location unavailable" ? null : display;
    if (!location.country && !location.region && !location.city) {
      logDiagnostic("ip2location_no_location_data");
      return null;
    }

    if (remoteCache.size >= MAX_CACHE_SIZE) remoteCache.delete(remoteCache.keys().next().value);
    remoteCache.set(ip, { value: { ...location }, expiresAt: Date.now() + CACHE_TTL_MS });
    logDiagnostic(location.city ? "ip2location_city_lookup_success" : location.region ? "ip2location_region_lookup_success" : "ip2location_country_lookup_success");
    return location;
  } catch (error) {
    logDiagnostic(error?.name === "TimeoutError" || error?.name === "AbortError" ? "ip2location_timeout" : "ip2location_unavailable");
    return null;
  }
};

/**
 * Resolve location through the hosted IP geolocation API first, with the
 * bundled geoip-lite database as a no-network fallback.
 */
export const resolveClientLocationAsync = async (value) => {
  const ip = getReliableClientIp(value);
  if (!normalizeIp(value) || !ip) return resolveClientLocation(value);
  const remote = await lookupRemoteGeo(ip);
  if (remote) return remote;
  return resolveClientLocation(ip);
};
