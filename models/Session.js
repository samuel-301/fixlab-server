import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sessionId: { type: String, required: true, unique: true },
    ip: String,
    location: String,
    geolocation: { type: mongoose.Schema.Types.Mixed, default: undefined },
    locationMethod: { type: String, enum: ["browser-geolocation", "ip-geolocation", "unavailable"] },
    locationCapturedAt: Date,
    locationAccuracyMeters: { type: Number, min: 1, max: 100000 },
    userAgent: String,
    device: String,
    platform: String,
    browser: String,
    browserVersion: { type: String, maxlength: 80 },
    deviceType: { type: String, maxlength: 40 },
    authMethod: { type: String, enum: ["password", "google", "email-link"], default: "password" },
    isNewDevice: { type: Boolean, default: true },
    isRecognizedDevice: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
  },
  { timestamps: true }
);


export default mongoose.model("Session", sessionSchema);
