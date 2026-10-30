import mongoose from "mongoose";
import NotificationPreference from "../models/NotificationPreference.js";
import WebPushSubscription from "../models/WebPushSubscription.js";
import { describeUserAgent } from "../utils/session-management.js";
import { isWebPushConfigured, validPushSubscription } from "../utils/web-push.js";
import { isSecurityEmailConfigured } from "../utils/email.js";
import SecurityNotification from "../models/SecurityNotification.js";
import Session from "../models/Session.js";
import LoginEvent from "../models/LoginEvent.js";
import { storedLocationFrom } from "../utils/geolocation.js";

export const getSecurityNotifications = async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const before = req.query.before && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
  try {
    const filter = { user: req.user._id, ...(before ? { createdAt: { $lt: before } } : {}) };
    const [items, unreadCount] = await Promise.all([
      SecurityNotification.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      SecurityNotification.countDocuments({ user: req.user._id, readAt: null }),
    ]);
    res.json({ items: items.map((item) => {
      const { location, geolocation } = storedLocationFrom(item);
      return { id: String(item._id), title: item.title, message: item.message, createdAt: item.createdAt, read: Boolean(item.readAt), href: "/dashboard/security", details: { location, ip: item.ip || "Unknown", locationMethod: item.locationMethod || item.geolocation?.method || "unavailable", locationCapturedAt: item.locationCapturedAt || item.geolocation?.capturedAt || null, locationAccuracyMeters: item.locationAccuracyMeters ?? item.geolocation?.accuracyMeters ?? null, browser: item.browser || "Unknown browser", browserVersion: item.browserVersion || "Unknown version", platform: item.platform || "Unknown operating system", device: item.device || "Unknown device", deviceType: item.deviceType || "Unknown", userAgent: item.userAgent || "Unavailable", authMethod: item.authMethod } };
    }), unreadCount, nextBefore: items.length === limit ? items[items.length - 1].createdAt : null });
  } catch { res.status(500).json({ message: "Unable to load notifications." }); }
};

export const getCurrentLoginNotification = async (req, res) => {
  try {
    const item = await SecurityNotification.findOne({
      user: req.user._id,
      sessionId: req.sessionId,
      type: "login",
    }).lean();
    if (!item) return res.json({ item: null });
    const { location } = storedLocationFrom(item);
    return res.json({
      item: {
        id: String(item._id),
        title: item.title,
        message: item.message,
        createdAt: item.createdAt,
        read: Boolean(item.readAt),
        details: {
          location,
          ip: item.ip || "Unknown",
          browser: item.browser || "Unknown browser",
          browserVersion: item.browserVersion || "Unknown version",
          platform: item.platform || "Unknown operating system",
          device: item.device || "Unknown device",
          deviceType: item.deviceType || "Unknown",
          userAgent: item.userAgent || "Unavailable",
          authMethod: item.authMethod,
        },
      },
    });
  } catch {
    return res.status(500).json({ message: "Unable to load the current login alert." });
  }
};

export const getUnreadSecurityNotificationCount = async (req, res) => {
  try { res.json({ unreadCount: await SecurityNotification.countDocuments({ user: req.user._id, readAt: null }) }); }
  catch { res.status(500).json({ message: "Unable to load unread notification count." }); }
};

export const markSecurityNotificationRead = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Notification not found." });
  try {
    const notification = await SecurityNotification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { $set: { readAt: new Date() } }, { new: true });
    if (!notification) return res.status(404).json({ message: "Notification not found." });
    res.json({ id: String(notification._id), read: true });
  } catch { res.status(500).json({ message: "Unable to update notification." }); }
};

export const getLoginEvents = async (req, res) => {
  try {
    const events = await LoginEvent.find({ user: req.user._id }).sort({ occurredAt: -1 }).limit(Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50))).lean();
    const sessionIds = events.map((event) => event.sessionId);
    const activeSessions = await Session.find({ user: req.user._id, sessionId: { $in: sessionIds } }).select("sessionId").lean();
    const active = new Set(activeSessions.map((session) => session.sessionId));
    res.json(events.map((event) => {
      const { location, geolocation } = storedLocationFrom(event);
      return { ...event, active: active.has(event.sessionId), location, geolocation, locationMethod: event.locationMethod || geolocation.method || geolocation.source || "unavailable", locationCapturedAt: event.locationCapturedAt || geolocation.capturedAt || null, locationAccuracyMeters: event.locationAccuracyMeters ?? geolocation.accuracyMeters ?? null, authMethod: event.authMethod || "password", isNewDevice: event.isNewDevice !== false };
    }));
  } catch { res.status(500).json({ message: "Unable to load login activity." }); }
};

export const getSecurityNotificationSettings = async (req, res) => {
  try {
    const [preference, subscriptions] = await Promise.all([
      NotificationPreference.findOne({ user: req.user._id }).lean(),
      WebPushSubscription.find({ user: req.user._id }).select("deviceLabel createdAt"),
    ]);
    res.json({
      emailLoginAlerts: preference?.emailLoginAlerts !== false,
      emailConfigured: isSecurityEmailConfigured(),
      pushEnabled: preference?.pushEnabled === true,
      pushConfigured: isWebPushConfigured(),
      vapidPublicKey: isWebPushConfigured() ? process.env.VAPID_PUBLIC_KEY : null,
      subscriptions: subscriptions.map(({ _id, deviceLabel, createdAt }) => ({ _id, deviceLabel, createdAt })),
    });
  } catch {
    res.status(500).json({ message: "Unable to load security notification settings." });
  }
};

export const getCurrentWebPushSubscription = async (req, res) => {
  const endpoint = req.query.endpoint;
  if (typeof endpoint !== "string" || endpoint.length > 2048) return res.status(400).json({ message: "A valid subscription endpoint is required." });
  try {
    const subscription = await WebPushSubscription.findOne({ user: req.user._id, endpoint }).select("_id").lean();
    res.json({ id: subscription ? String(subscription._id) : null });
  } catch {
    res.status(500).json({ message: "Unable to check this browser subscription." });
  }
};

export const updateSecurityNotificationSettings = async (req, res) => {
  const updates = {};
  for (const key of ["emailLoginAlerts", "pushEnabled"]) {
    if (Object.hasOwn(req.body || {}, key)) {
      if (typeof req.body[key] !== "boolean") return res.status(400).json({ message: "Notification preferences must be boolean values." });
      updates[key] = req.body[key];
    }
  }
  if (!Object.keys(updates).length) return res.status(400).json({ message: "Choose a notification preference to update." });
  try {
    const preference = await NotificationPreference.findOneAndUpdate(
      { user: req.user._id },
      { $set: updates },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.json({ emailLoginAlerts: preference.emailLoginAlerts, pushEnabled: preference.pushEnabled });
  } catch {
    res.status(500).json({ message: "Unable to update security notification settings." });
  }
};

export const registerWebPushSubscription = async (req, res) => {
  if (!isWebPushConfigured()) {
    return res.status(503).json({ message: "Push notifications are not configured." });
  }
  const subscription = req.body?.subscription;
  if (!validPushSubscription(subscription)) return res.status(400).json({ message: "Invalid browser push subscription." });
  try {
    const count = await WebPushSubscription.countDocuments({ user: req.user._id });
    const existing = await WebPushSubscription.findOne({ endpoint: subscription.endpoint }).select("_id user");
    if (existing && String(existing.user) !== String(req.user._id)) {
      return res.status(409).json({ message: "This browser subscription is already registered to another account." });
    }
    if (!existing && count >= 10) return res.status(409).json({ message: "This account has reached the device notification limit." });
    const details = describeUserAgent(req.get("user-agent") || "");
    const saved = await WebPushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint, user: req.user._id },
      {
        $set: {
          user: req.user._id,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          deviceLabel: `${details.browserName} on ${details.platform}`.slice(0, 100),
        },
      },
      { new: true, upsert: true, runValidators: true },
    ).select("_id");
    await NotificationPreference.findOneAndUpdate(
      { user: req.user._id },
      { $set: { pushEnabled: true } },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true },
    );
    res.status(201).json({ id: saved._id, message: "Push notifications enabled for this browser." });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "This browser subscription is already registered to another account." });
    res.status(500).json({ message: "Unable to register this browser for push notifications." });
  }
};

export const removeWebPushSubscription = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.subscriptionId)) return res.status(404).json({ message: "Subscription not found." });
  try {
    const removed = await WebPushSubscription.findOneAndDelete({ _id: req.params.subscriptionId, user: req.user._id });
    if (!removed) return res.status(404).json({ message: "Subscription not found." });
    res.json({ message: "Push subscription removed." });
  } catch {
    res.status(500).json({ message: "Unable to remove this push subscription." });
  }
};
