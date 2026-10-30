import { isSecurityEmailConfigured, sendSecurityAlert } from "./email.js";
import SecurityNotification from "../models/SecurityNotification.js";
import { formatLocation } from "./geolocation.js";

export const sendSecurityNotifications = async (user, details, eventId) => {
  const occurredAt = details.time ? new Date(details.time) : new Date();
  const safeOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
  const location = formatLocation(details.geolocation || details.location) || "Location unavailable";
  const browser = details.browser || "Unknown browser";
  const browserVersion = details.browserVersion || "Unknown version";
  const platform = details.platform || "Unknown operating system";
  const device = details.device || "Unknown device";
  const deviceType = details.deviceType || "Unknown";
  const ip = details.ip || "Unknown";
  const userAgent = typeof details.userAgent === "string" ? details.userAgent.slice(0, 500) : "";
  const timezone = (() => {
    try { return new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
    catch { return "UTC"; }
  })();
  const dateTime = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone: timezone,
  }).format(safeOccurredAt);

  // The unique sessionId index makes one successful login produce at most one
  // persistent notification and one email, including concurrent retries.
  let notification;
  try {
    notification = await SecurityNotification.create({
      user: user._id,
      sessionId: eventId,
      title: "New login detected",
      message: "A new login to your FixLab account was detected. Here are the details.",
      location,
      ip: details.ip || undefined,
      geolocation: details.geolocation ? {
        source: details.geolocation.source,
        method: details.locationMethod || details.geolocation.method || "unavailable",
        display: location,
        capturedAt: details.locationCapturedAt || details.geolocation.capturedAt || null,
      } : undefined,
      locationMethod: details.locationMethod || details.geolocation?.method || "unavailable",
      locationCapturedAt: details.locationCapturedAt ? new Date(details.locationCapturedAt) : undefined,
      browser,
      browserVersion,
      platform,
      device,
      deviceType,
      userAgent: userAgent || undefined,
      authMethod: details.authMethod || "password",
      emailStatus: user.email && user.emailVerified === true && isSecurityEmailConfigured() ? "pending" : "skipped",
      pushStatus: "skipped",
    });
  } catch (error) {
    if (error?.code === 11000) {
      return SecurityNotification.findOne({ sessionId: eventId, user: user._id });
    }
    throw error;
  }

  // Browser Notifications API is triggered by the signed-in frontend.
  // This backend intentionally does not require VAPID keys or a push provider.

  // Email is automatic and independent of browser push preferences. Failure
  // is recorded but never affects the completed authentication/session.
  if (user.email && user.emailVerified === true && isSecurityEmailConfigured()) {
    void (async () => {
      try {
        await sendSecurityAlert(user.email, user.username, {
          ...details,
          time: safeOccurredAt.toISOString(),
          dateTime,
          timezone,
          location,
          ip: details.ip || "Unknown",
          browser,
          browserVersion,
          platform,
          device,
          deviceType,
          userAgent,
          sessionsUrl: details.sessionsUrl,
        }, eventId);
        await SecurityNotification.updateOne({ _id: notification._id }, { $set: { emailStatus: "sent", emailAttempts: 1 } });
      } catch {
        await SecurityNotification.updateOne({ _id: notification._id }, { $set: { emailStatus: "failed", emailAttempts: 1 } }).catch(() => {});
        console.warn("Login security email delivery failed");
      }
    })();
  }
  return notification;
};
