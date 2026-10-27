import NotificationPreference from "../models/NotificationPreference.js";
import { isSecurityEmailConfigured, sendSecurityAlert } from "./email.js";
import { buildLoginPushPayload, sendLoginPushNotifications } from "./web-push.js";
import SecurityNotification from "../models/SecurityNotification.js";
import { formatLocation } from "./geolocation.js";

const retryDelivery = async (send, onAttempt, maxAttempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await onAttempt(attempt);
    try { return await send(); }
    catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
};

export const sendSecurityNotifications = async (user, details, eventId) => {
  const location = formatLocation(details.geolocation || details.location);
  const safeGeolocation = details.geolocation ? {
    source: details.geolocation.source,
    method: details.locationMethod || details.geolocation.method || "unavailable",
    accuracyMeters: details.locationAccuracyMeters ?? details.geolocation.accuracyMeters ?? null,
    capturedAt: details.locationCapturedAt || details.geolocation.capturedAt || null,
    display: location,
  } : undefined;
  const notificationDetails = { ...details, location, geolocation: safeGeolocation };
  const preference = await NotificationPreference.findOne({ user: user._id }).lean().catch(() => null);
  const notification = await SecurityNotification.create({
    user: user._id,
    sessionId: eventId,
    title: "New login detected",
    message: `Successful ${details.authMethod === "google" ? "Google" : details.authMethod === "password" ? "email and password" : "verified email"} sign-in near ${location} using ${details.browser || details.device || "an unknown browser or device"}.`,
    location,
    locationMethod: details.locationMethod || details.geolocation?.method || "unavailable",
    locationCapturedAt: details.locationCapturedAt ? new Date(details.locationCapturedAt) : undefined,
    locationAccuracyMeters: details.locationAccuracyMeters ?? undefined,
    browser: details.browser || "Unknown browser",
    platform: details.platform || "Unknown platform",
    device: details.device || "Unknown device",
    authMethod: details.authMethod || "password",
    emailStatus: user.email && user.emailVerified === true && preference?.emailLoginAlerts !== false && isSecurityEmailConfigured() ? "pending" : "skipped",
    pushStatus: preference?.pushEnabled === true ? "pending" : "skipped",
  });
  const socketServer = global.io;
  if (socketServer && preference?.pushEnabled === true) socketServer.to(`user:${user._id}`).emit("security-notification", {
    id: String(notification._id), title: notification.title, message: notification.message,
    createdAt: notification.createdAt, read: false, href: "/dashboard/sessions",
    details: { location: notification.location, locationMethod: notification.locationMethod, locationCapturedAt: notification.locationCapturedAt, locationAccuracyMeters: notification.locationAccuracyMeters, browser: notification.browser, platform: notification.platform, device: notification.device, authMethod: notification.authMethod },
  });
  const deliveries = [];
  if (user.email && user.emailVerified === true && preference?.emailLoginAlerts !== false && isSecurityEmailConfigured()) {
    deliveries.push(retryDelivery(
      () => sendSecurityAlert(user.email, user.username, notificationDetails, eventId),
      (attempt) => SecurityNotification.updateOne({ _id: notification._id }, { $set: { emailAttempts: attempt } }),
    )
      .then(async () => { await SecurityNotification.updateOne({ _id: notification._id }, { $set: { emailStatus: "sent" } }); return "sent"; })
      .catch(() => {
        console.warn("Login security email delivery failed");
        void SecurityNotification.updateOne({ _id: notification._id }, { $set: { emailStatus: "failed" } });
        return "failed";
      }));
  }
  if (preference?.pushEnabled === true) {
    deliveries.push(retryDelivery(async () => {
      const result = await sendLoginPushNotifications(user._id, buildLoginPushPayload({
      device: details.device,
      location,
      time: details.time,
      locationMethod: details.locationMethod || details.geolocation?.method || "unavailable",
      locationAccuracyMeters: details.locationAccuracyMeters ?? details.geolocation?.accuracyMeters,
      notificationId: notification._id,
      }));
      if (result?.failed > 0 && result.sent === 0) throw new Error("Push delivery failed");
      return result;
    }, (attempt) => SecurityNotification.updateOne({ _id: notification._id }, { $set: { pushAttempts: attempt } }))
      .then(async (result) => { await SecurityNotification.updateOne({ _id: notification._id }, { $set: { pushStatus: result?.sent > 0 ? "sent" : "skipped" } }); return result; })
      .catch(() => {
        console.warn("Login security push delivery failed");
        void SecurityNotification.updateOne({ _id: notification._id }, { $set: { pushStatus: "failed" } });
        return { failed: 1 };
      }));
  }
  void Promise.allSettled(deliveries);
  return notification;
};
