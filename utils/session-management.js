import useragent from "useragent";
import { getReliableClientIp, resolveClientLocation, formatLocation } from "./geolocation.js";

export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export { getReliableClientIp } from "./geolocation.js";

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
  const savedLocation = session.geolocation && typeof session.geolocation === "object"
    ? session.geolocation
    : null;
  const resolved = savedLocation && (savedLocation.city || savedLocation.country)
    ? savedLocation
    : resolveClientLocation(session.ip);
  const ip = resolved.ip || getReliableClientIp(session.ip);
  const location = session.location && session.location !== "Unavailable" && session.location !== "Unknown location"
    ? session.location
    : formatLocation(resolved);
  const detected = describeUserAgent(session.userAgent);

  return {
    _id: session._id,
    sessionId: session.sessionId,
    ip: ip || "Unavailable",
    location,
    geolocation: resolved,
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


/**
 * Revoke a single session only when it belongs to the requested user.
 * Returns the deleted session document so callers can notify that device.
 */
export const revokeOwnedSession = async (SessionModel, userId, sessionId) => {
  if (!SessionModel || !userId || typeof sessionId !== "string") {
    throw new TypeError("Session model, user ID, and session ID are required");
  }
  return SessionModel.findOneAndDelete({ user: userId, sessionId });
};

/**
 * Revoke every session except the caller's current session.
 * The current session is preserved so the user remains signed in.
 */
export const revokeOtherSessions = async (SessionModel, userId, currentSessionId) => {
  if (!SessionModel || !userId || typeof currentSessionId !== "string" || !currentSessionId) {
    throw new TypeError("Session model, user ID, and current session ID are required");
  }
  return SessionModel.deleteMany({
    user: userId,
    sessionId: { $ne: currentSessionId },
  });
};
