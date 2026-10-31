import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: String,
  emailVerified: { type: Boolean, default: false },
  normalizedEmail: { type: String, sparse: true, unique: true },
  profileImage: String,
  profileImagePublicId: String,
  fullName: String,
  password: { type: String, required: true },
  provider: { type: String, default: "local" },
  googleSub: { type: String, sparse: true, unique: true },
  emailLoginAlerts: { type: Boolean, default: true },
  pushEnabled: { type: Boolean, default: false },
  role: { type: String, enum: ["user", "admin"], default: "user" },
});

export default mongoose.model("User", userSchema);
