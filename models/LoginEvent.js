import mongoose from "mongoose";

const loginEventSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  sessionId: { type: String, required: true, unique: true },
  occurredAt: { type: Date, default: Date.now },
  ip: { type: String, maxlength: 64 },
  location: { type: String, default: "Location unavailable", maxlength: 160 },
  geolocation: { type: mongoose.Schema.Types.Mixed, default: undefined },
  browser: { type: String, default: "Unknown browser", maxlength: 160 },
  platform: { type: String, default: "Unknown platform", maxlength: 100 },
  device: { type: String, default: "Unknown device", maxlength: 100 },
  authMethod: { type: String, enum: ["password", "google", "email-link"], default: "password" },
  isNewDevice: { type: Boolean, default: true },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });

loginEventSchema.index({ user: 1, occurredAt: -1 });
loginEventSchema.index({ occurredAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });

export default mongoose.model("LoginEvent", loginEventSchema);
