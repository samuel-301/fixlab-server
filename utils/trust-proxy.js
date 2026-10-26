import { isPublicIp, normalizeIp } from "./geolocation.js";

const parseExplicitTrustProxy = (value) => {
  // Missing environment variables must not become the literal strings
  // "undefined" or "null", which Express would try to parse as IP addresses.
  if (value == null) return null;

  const trustedProxy = String(value).trim();
  if (!trustedProxy || /^(undefined|null)$/i.test(trustedProxy)) return null;
  if (trustedProxy.toLowerCase() === "false") return false;
  if (trustedProxy.toLowerCase() === "true") return true;
  if (/^\d+$/.test(trustedProxy)) return Number(trustedProxy);

  const list = trustedProxy.split(",").map((entry) => entry.trim()).filter(Boolean);
  // Reject placeholder values instead of passing them to Express as IPs.
  if (!list.length || list.some((entry) => /^(undefined|null)$/i.test(entry))) return null;
  return list;
};

/**
 * Trust the connecting peer and any additional private/reserved hops, then
 * stop at the first public address. That matches Render's reverse-proxy
 * topology without honoring a client-spoofed public X-Forwarded-For value.
 */
export const trustPrivateProxyHops = (_addr, i) => {
  if (i === 0) return true;
  const ip = normalizeIp(_addr);
  return Boolean(ip) && !isPublicIp(ip);
};

export const resolveTrustProxySetting = (env = process.env) => {
  const explicit = parseExplicitTrustProxy(env.TRUSTED_PROXY);
  if (explicit !== null) return explicit;
  if (env.RENDER || env.RENDER_SERVICE_ID || env.NODE_ENV === "production") {
    return trustPrivateProxyHops;
  }
  return false;
};
