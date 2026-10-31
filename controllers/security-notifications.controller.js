import mongoose from "mongoose";
import User from "../models/User.js";
import PushSubscription from "../models/PushSubscription.js";
import { getVapidPublicKey, isPushConfigured } from "../utils/push-notifications.js";
import { describeUserAgent } from "../utils/session-management.js";

const validSubscription = (value) => {
  if (!value || typeof value !== "object" || typeof value.endpoint !== "string" ||
      value.endpoint.length > 2048 || !value.endpoint.startsWith("https://") ||
      !value.keys || typeof value.keys.p256dh !== "string" || typeof value.keys.auth !== "string" ||
      value.keys.p256dh.length > 256 || value.keys.auth.length > 256) return false;
  try {
    const endpoint = new URL(value.endpoint);
    return endpoint.protocol === "https:" && Boolean(endpoint.hostname);
  } catch {
    return false;
  }
};

export const getSecurityNotificationSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("emailLoginAlerts pushEnabled");
    if (!user) return res.status(404).json({ message: "Account not found." });
    const subscriptions = await PushSubscription.find({ user: user._id })
      .select("_id deviceLabel createdAt")
      .sort({ createdAt: -1 })
      .lean();
    return res.json({
      emailLoginAlerts: user.emailLoginAlerts !== false,
      emailConfigured: Boolean(process.env.BREVO_API_KEY && process.env.EMAIL_FROM),
      pushEnabled: user.pushEnabled === true,
      pushConfigured: isPushConfigured(),
      vapidPublicKey: getVapidPublicKey(),
      subscriptions,
    });
  } catch {
    return res.status(503).json({ message: "Unable to load security notification settings." });
  }
};

export const updateSecurityNotificationSettings = async (req, res) => {
  const updates = {};
  for (const field of ["emailLoginAlerts", "pushEnabled"]) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
      if (typeof req.body[field] !== "boolean") return res.status(400).json({ message: "Notification preferences must be boolean values." });
      updates[field] = req.body[field];
    }
  }
  if (!Object.keys(updates).length) return res.status(400).json({ message: "No notification preference was provided." });
  try {
    const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true, runValidators: true }).select("emailLoginAlerts pushEnabled");
    if (!user) return res.status(404).json({ message: "Account not found." });
    return res.json({ emailLoginAlerts: user.emailLoginAlerts !== false, pushEnabled: user.pushEnabled === true });
  } catch {
    return res.status(503).json({ message: "Unable to update notification preferences." });
  }
};

export const getCurrentPushSubscription = async (req, res) => {
  const endpoint = typeof req.query.endpoint === "string" ? req.query.endpoint : "";
  if (!endpoint || endpoint.length > 2048) return res.status(400).json({ message: "A valid browser subscription endpoint is required." });
  try {
    const subscription = await PushSubscription.findOne({ user: req.user._id, endpoint }).select("_id");
    return res.json({ id: subscription ? String(subscription._id) : null });
  } catch {
    return res.status(503).json({ message: "Unable to check this browser subscription." });
  }
};

export const registerPushSubscription = async (req, res) => {
  const subscription = req.body?.subscription;
  if (!validSubscription(subscription)) return res.status(400).json({ message: "The browser push subscription is invalid." });
  try {
    const existing = await PushSubscription.findOne({ endpoint: subscription.endpoint }).select("_id user");
    if (existing && String(existing.user) !== String(req.user._id)) {
      return res.status(409).json({ message: "This browser subscription is already associated with another account." });
    }
    const agent = typeof req.get("user-agent") === "string" ? req.get("user-agent") : "";
    const details = describeUserAgent(agent);
    const deviceLabel = [details.device, details.browser].filter(Boolean).join(" · ").slice(0, 120) || "Browser";
    const expirationTime = Number.isFinite(subscription.expirationTime) ? new Date(subscription.expirationTime) : null;
    const saved = await PushSubscription.findOneAndUpdate(
      { user: req.user._id, endpoint: subscription.endpoint },
      { $set: { keys: subscription.keys, expirationTime, deviceLabel } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    ).select("_id");
    console.info("[push] subscription registered", { subscriptionId: String(saved._id), userId: String(req.user._id) });
    return res.status(201).json({ id: String(saved._id) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "This browser subscription is already registered." });
    return res.status(503).json({ message: "Unable to register this browser subscription." });
  }
};

export const removePushSubscription = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Browser subscription not found." });
  try {
    const removed = await PushSubscription.findOneAndDelete({ _id: req.params.id, user: req.user._id }).select("_id");
    if (!removed) return res.status(404).json({ message: "Browser subscription not found." });
    console.info("[push] subscription removed", { subscriptionId: String(removed._id), userId: String(req.user._id) });
    return res.json({ message: "Browser subscription removed." });
  } catch {
    return res.status(503).json({ message: "Unable to remove this browser subscription." });
  }
};
