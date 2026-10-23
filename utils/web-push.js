import webpush from "web-push";
import WebPushSubscription from "../models/WebPushSubscription.js";

const decodeVapidKey = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return null;
  }
};

export const isWebPushConfigured = () => {
  const publicKey = decodeVapidKey(process.env.VAPID_PUBLIC_KEY);
  const privateKey = decodeVapidKey(process.env.VAPID_PRIVATE_KEY);
  const subject = process.env.VAPID_SUBJECT?.trim();
  return Boolean(publicKey?.length === 65 && publicKey[0] === 4 && privateKey?.length === 32 &&
    (subject?.startsWith("mailto:") || subject?.startsWith("https://")));
};

const configure = () => {
  if (!isWebPushConfigured()) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  return true;
};

export const validPushSubscription = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.endpoint !== "string" || value.endpoint.length > 2048) return false;
  try {
    const endpoint = new URL(value.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return false;
    const host = endpoint.hostname.toLowerCase();
    const trustedPushHost = host === "fcm.googleapis.com" ||
      host === "updates.push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com") ||
      host === "web.push.apple.com" || host.endsWith(".notify.windows.com");
    if (!trustedPushHost) return false;
  } catch {
    return false;
  }
  return typeof value.keys?.p256dh === "string" && /^[A-Za-z0-9_-]{40,200}$/.test(value.keys.p256dh) &&
    typeof value.keys?.auth === "string" && /^[A-Za-z0-9_-]{16,100}$/.test(value.keys.auth);
};

export const buildLoginPushPayload = ({ device, location, time, notificationId }) => JSON.stringify({
  title: "FixLab — New sign-in detected",
  body: `A new sign-in to your FixLab account was detected near ${String(location || "Location unavailable").slice(0, 100)}, using ${String(device || "an unknown browser or device").slice(0, 120)} at ${String(time || "Time unavailable").slice(0, 40)} UTC. If this wasn't you, review your account security.`,
  url: "/dashboard/sessions",
  tag: notificationId ? `fixlab-${String(notificationId).slice(0, 80)}` : "fixlab-login-security",
});

export const sendLoginPushNotifications = async (userId, payload) => {
  if (!configure()) return { sent: 0, removed: 0, failed: 0, configured: false };
  const subscriptions = await WebPushSubscription.find({ user: userId })
    .select("+endpoint +p256dh +auth");
  const results = await Promise.all(subscriptions.map(async (record) => {
    const subscription = {
      endpoint: record.endpoint,
      keys: { p256dh: record.p256dh, auth: record.auth },
    };
    try {
      await webpush.sendNotification(subscription, payload, { TTL: 60 * 60, urgency: "high" });
      return "sent";
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await WebPushSubscription.deleteOne({ _id: record._id, user: userId });
        return "removed";
      }
      return "failed";
    }
  }));
  const summary = {
    sent: results.filter((result) => result === "sent").length,
    removed: results.filter((result) => result === "removed").length,
    failed: results.filter((result) => result === "failed").length,
    configured: true,
  };
  if (subscriptions.length) console.info("Login push delivery completed", summary);
  return summary;
};
