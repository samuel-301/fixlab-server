import webPush from "web-push";
import PushSubscription from "../models/PushSubscription.js";
import Session from "../models/Session.js";

const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
const subject = process.env.VAPID_SUBJECT?.trim() || "";
const validSubject = /^mailto:.+@.+$/.test(subject) || /^https:\/\/.+/.test(subject);
let configured = false;

if (publicKey && privateKey && validSubject) {
  try {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
    console.info("[push] VAPID configured");
  } catch (error) {
    console.error("[push] VAPID configuration failed", {
      name: String(error?.name || "Error").slice(0, 60),
      code: String(error?.code || "").slice(0, 60),
    });
  }
}

export const isPushConfigured = () => configured;
export const getVapidPublicKey = () => configured ? publicKey : null;

const safeError = (error) => ({
  statusCode: Number(error?.statusCode) || undefined,
  code: String(error?.code || "").slice(0, 60) || undefined,
});

export const sendNewDevicePush = async ({
  userId,
  sessionId,
  device,
  browser,
  location,
  loginTime,
  excludeEndpoint,
}) => {
  if (!configured) return;
  try {
    // Atomic claim prevents duplicate delivery attempts for the same login session.
    const claimed = await Session.findOneAndUpdate(
      { sessionId, user: userId, pushNotificationSentAt: null },
      { $set: { pushNotificationSentAt: new Date() } },
      { new: true },
    );
    if (!claimed) return;

    const query = { user: userId };
    if (typeof excludeEndpoint === "string" && excludeEndpoint.startsWith("https://") && excludeEndpoint.length <= 2048) {
      query.endpoint = { $ne: excludeEndpoint };
    }
    const subscriptions = await PushSubscription.find(query).select("+endpoint +keys.p256dh +keys.auth");
    if (!subscriptions.length) return;

    const when = loginTime instanceof Date ? loginTime : new Date(loginTime || Date.now());
    const dateLabel = Number.isNaN(when.getTime()) ? new Date().toLocaleString("en-US", { timeZone: "UTC" }) : when.toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short", timeZoneName: "short" });
    const deviceLabel = [device, browser].filter((value) => typeof value === "string" && value.trim()).join(" · ") || "Unknown device";
    const locationLabel = typeof location === "string" && location.trim() ? location.trim().slice(0, 120) : "Location unavailable";
    const payload = JSON.stringify({
      title: "New sign-in to FixLab",
      body: `A new sign-in was detected on ${deviceLabel} near ${locationLabel} at ${dateLabel}.`,
      tag: `fixlab-login-${sessionId}`,
      url: "/dashboard/sessions",
    });

    console.info("[push] notification sending", { sessionId, subscriptionCount: subscriptions.length });
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification({
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        }, payload, { TTL: 60, urgency: "high" });
        console.info("[push] notification sent", { subscriptionId: String(subscription._id), sessionId });
      } catch (error) {
        const details = safeError(error);
        console.warn("[push] delivery failed", { subscriptionId: String(subscription._id), sessionId, ...details });
        if (details.statusCode === 404 || details.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: subscription._id, user: userId }).catch(() => {});
          console.info("[push] subscription removed", { subscriptionId: String(subscription._id), reason: "expired" });
        }
      }
    }));
  } catch (error) {
    console.error("[push] notification delivery failed", { sessionId, ...safeError(error) });
  }
};
