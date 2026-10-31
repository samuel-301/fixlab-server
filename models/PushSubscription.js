import mongoose from "mongoose";

const pushSubscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  endpoint: { type: String, required: true, maxlength: 2048, select: false },
  keys: {
    p256dh: { type: String, required: true, select: false },
    auth: { type: String, required: true, select: false },
  },
  expirationTime: { type: Date, default: null },
  deviceLabel: { type: String, default: "Browser", maxlength: 120 },
}, { timestamps: true });

pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
pushSubscriptionSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("PushSubscription", pushSubscriptionSchema);
