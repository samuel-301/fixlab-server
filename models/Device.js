import mongoose from "mongoose";

const deviceSchema = new mongoose.Schema({
  serialNumberOrIMEI: { type: String, required: true, unique: true },
  deviceName: String,
  deviceModel: String,
  customerName: String,
  phoneNumber: String,
  image: String,
  imagePublicId: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
}, { timestamps: true });

export default mongoose.model("Device", deviceSchema);
