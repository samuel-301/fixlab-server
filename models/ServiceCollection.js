import mongoose from "mongoose";

const serviceCollectionSchema = new mongoose.Schema(
  {
    recordNumber: { type: String, required: true, unique: true },
    serviceDate: { type: Date, default: Date.now },

    device: { type: mongoose.Schema.Types.ObjectId, ref: "Device", required: true },
    collection: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Collection",
      required: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // receptionist
  },
  { timestamps: true }
);

export default mongoose.model("ServiceCollection", serviceCollectionSchema);
