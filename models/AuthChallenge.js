import mongoose from "mongoose";

const authChallengeSchema = new mongoose.Schema({
  email: { type: String, required: true, index: true },
  purpose: { type: String, enum: ["sign-in", "password-reset"], required: true },
  otpHash: String,
  linkTokenHash: String,
  registrationTokenHash: String,
  expiresAt: { type: Date, required: true, expires: 0 },
  attempts: { type: Number, default: 0 },
  verifiedAt: Date,
  consumedAt: Date,
}, { timestamps: true });

export default mongoose.model("AuthChallenge", authChallengeSchema);