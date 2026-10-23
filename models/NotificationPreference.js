import mongoose from "mongoose";

const notificationPreferenceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  emailLoginAlerts: { type: Boolean, default: true },
  pushEnabled: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model("NotificationPreference", notificationPreferenceSchema);
