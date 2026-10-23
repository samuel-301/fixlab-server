import mongoose from 'mongoose';

const collectionSchema = new mongoose.Schema({
  collectionNumber: { type: String, required: true, unique: true },
  collectionName: { type: String, required: true },
  collectionDescription: { type: String, required: true },
  collectionPrice: { type: Number, required: true },
  createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
}, { timestamps: true });

export default mongoose.model('Collection', collectionSchema);
