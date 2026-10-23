import { isIP } from "node:net";
import useragent from "useragent";
import geoip from "geoip-lite";

export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeIp = (value) => {
  if (typeof value !== "string") return null;
  const ip = value.trim().replace(/^\[|\]$/g, "");
  const ipv4Mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  const normalized = ipv4Mapped ? ipv4Mapped[1] : ip;
  return isIP(normalized) ? normalized : null;
};

const isPublicIp = (ip) => {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  if (isIP(normalized) === 4) {
    const [first, second] = normalized.split(".").map(Number);
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0 && (normalized.split(".")[2] === "0" || normalized.split(".")[2] === "2")) ||
      (first === 198 && (second === 18 || second === 19 || second === 51)) ||
      (first === 203 && second === 0 && normalized.split(".")[2] === "113") ||
      first >= 224
    );
  }

  const lower = normalized.toLowerCase();
  return (lower.startsWith("2") || lower.startsWith("3")) && !(
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("2001:db8:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    /^fe[89ab]/.test(lower)
  );
};

export const getReliableClientIp = (requestIp) => {
  const ip = normalizeIp(requestIp);
  return ip && isPublicIp(ip) ? ip : null;
};

const readableBrowserName = (family) => {
  if (!family || family === "Other") return "Unknown browser";
  return family.replace(/\s+Mobile$/i, "").replace(/^Mobile\s+/i, "");
};

export const describeUserAgent = (userAgentString) => {
  const raw = typeof userAgentString === "string" ? userAgentString : "";
  try {
    const parsed = useragent.parse(raw);
    const deviceFamily = parsed.device?.family && parsed.device.family !== "Other"
      ? parsed.device.family
      : "";
    const platform = parsed.os?.family && parsed.os.family !== "Other" ? parsed.os.family : "Unknown platform";
    const browser = readableBrowserName(parsed.family);
    const knownPlatform = platform !== "Unknown platform";
    const deviceType = !deviceFamily && !knownPlatform
      ? "Unknown"
      : /ipad|tablet/i.test(deviceFamily)
        ? "Tablet"
        : /iphone|ipod|mobile|android/i.test(deviceFamily) || /android|ios/i.test(platform)
          ? "Mobile"
          : "Desktop";
    const isAppleMobile = /iphone|ipad|ipod/i.test(deviceFamily);
    const context = isAppleMobile ? deviceFamily : /android|ios/i.test(platform) ? platform : deviceFamily || platform;

    return {
      browser: `${browser} on ${context}`,
      browserName: browser,
      platform,
      device: deviceFamily || (deviceType === "Mobile" ? "Mobile device" : deviceType === "Tablet" ? "Tablet" : "Desktop"),
      deviceType,
    };
  } catch {
    return {
      browser: "Unknown browser",
      browserName: "Unknown browser",
      platform: "Unknown platform",
      device: "Unknown device",
      deviceType: "Unknown",
    };
  }
};

export const buildSessionResponse = (session, currentSessionId) => {
  const ip = getReliableClientIp(session.ip);
  const geolocation = ip ? geoip.lookup(ip) : null;
  const location = geolocation && (geolocation.city || geolocation.country)
    ? `Approx. ${[geolocation.city, geolocation.region, geolocation.country].filter(Boolean).join(", ")}`
    : "Unavailable";
  const detected = describeUserAgent(session.userAgent);

  return {
    _id: session._id,
    sessionId: session.sessionId,
    ip: ip || "Unavailable",
    location,
    browser: detected.browser,
    browserName: detected.browserName,
    platform: detected.platform,
    device: detected.device,
    deviceType: detected.deviceType,
    authMethod: session.authMethod || "password",
    isNewDevice: session.isNewDevice !== false,
    createdAt: session.createdAt,
    lastActive: session.lastActive || session.updatedAt || session.createdAt,
    isCurrent: session.sessionId === currentSessionId,
    isRecognizedDevice: session.isRecognizedDevice === true,
  };
};

export const revokeOwnedSession = (Session, userId, sessionId) =>
  Session.findOneAndDelete({ sessionId, user: userId });

export const revokeOtherSessions = (Session, userId, currentSessionId) =>
  Session.deleteMany({ user: userId, sessionId: { $ne: currentSessionId } });
