import mongoose from "mongoose";

const securityNotificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  sessionId: { type: String, required: true },
  type: { type: String, enum: ["login"], default: "login" },
  title: { type: String, required: true, maxlength: 120 },
  message: { type: String, required: true, maxlength: 500 },
  location: { type: String, default: "Unknown location", maxlength: 160 },
  browser: { type: String, default: "Unknown browser", maxlength: 160 },
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
