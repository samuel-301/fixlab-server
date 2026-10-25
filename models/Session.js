import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sessionId: { type: String, required: true, unique: true },
    ip: String,
    location: String,
    geolocation: { type: mongoose.Schema.Types.Mixed, default: undefined },
    userAgent: String,
    device: String,
    platform: String,
    browser: String,
    authMethod: { type: String, enum: ["password", "google", "email-link"], default: "password" },
    isNewDevice: { type: Boolean, default: true },
    isRecognizedDevice: { type: Boolean, default: false },
    alertSuppressionKey: { type: String, select: false },
    createdAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

sessionSchema.index({ alertSuppressionKey: 1 }, { unique: true, sparse: true });

export default mongoose.model("Session", sessionSchema);
