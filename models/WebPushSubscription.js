import mongoose from "mongoose";

const webPushSubscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  endpoint: { type: String, required: true, unique: true, select: false },
  p256dh: { type: String, required: true, select: false },
  auth: { type: String, required: true, select: false },
  deviceLabel: { type: String, default: "Browser", maxlength: 100 },
}, { timestamps: true });

export default mongoose.model("WebPushSubscription", webPushSubscriptionSchema);
