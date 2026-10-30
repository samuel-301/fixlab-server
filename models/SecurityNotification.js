import mongoose from "mongoose";

const securityNotificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  sessionId: { type: String, required: true },
  type: { type: String, enum: ["login"], default: "login" },
  title: { type: String, required: true, maxlength: 120 },
  message: { type: String, required: true, maxlength: 500 },
  location: { type: String, default: "Location unavailable", maxlength: 160 },
  ip: { type: String, maxlength: 64 },
  geolocation: { type: mongoose.Schema.Types.Mixed, default: undefined },
  locationMethod: { type: String, enum: ["browser-geolocation", "ip-geolocation", "unavailable"] },
  locationCapturedAt: Date,
  locationAccuracyMeters: { type: Number, min: 1, max: 100000 },
  browser: { type: String, default: "Unknown browser", maxlength: 160 },
  browserVersion: { type: String, default: "Unknown version", maxlength: 80 },
  deviceType: { type: String, default: "Unknown", maxlength: 40 },
  userAgent: { type: String, maxlength: 500 },
  platform: { type: String, default: "Unknown platform", maxlength: 100 },
  device: { type: String, default: "Unknown device", maxlength: 100 },
  authMethod: { type: String, enum: ["password", "google", "email-link"], default: "password" },
  readAt: { type: Date, default: null },
  emailStatus: { type: String, enum: ["pending", "sent", "failed", "skipped"], default: "pending" },
  pushStatus: { type: String, enum: ["pending", "sent", "failed", "skipped"], default: "pending" },
  emailAttempts: { type: Number, default: 0, min: 0, max: 3 },
  pushAttempts: { type: Number, default: 0, min: 0, max: 3 },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 365 },
}, { timestamps: true });

securityNotificationSchema.index({ user: 1, createdAt: -1 });
securityNotificationSchema.index({ sessionId: 1 }, { unique: true });

export default mongoose.model("SecurityNotification", securityNotificationSchema);
