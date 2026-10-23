import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });

const migrate = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing from server/.env");
  }

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is not available");

  const legacyRecords = await db.collection("cars").find({}).toArray();
  const devices = db.collection("devices");
  const serviceRecords = db.collection("servicecollections");

  let migratedDevices = 0;
  for (const legacy of legacyRecords) {
    const device = {
      _id: legacy._id,
      serialNumberOrIMEI: legacy.plateNumber || `LEGACY-${legacy._id}`,
      deviceName: legacy.carType || "",
      deviceModel: legacy.carSize || "",
      customerName: legacy.driverName || "",
      phoneNumber: legacy.phoneNumber || "",
      image: legacy.image || "",
      createdBy: legacy.createdBy,
      createdAt: legacy.createdAt || new Date(),
      updatedAt: legacy.updatedAt || new Date(),
    };

    await devices.updateOne(
      { _id: legacy._id },
      { $setOnInsert: device },
      { upsert: true },
    );
    migratedDevices += 1;
  }

  const oldServiceRecords = await serviceRecords.find({ car: { $exists: true } }).toArray();
  let migratedServices = 0;
  for (const service of oldServiceRecords) {
    await serviceRecords.updateOne(
      { _id: service._id, car: { $exists: true } },
      { $set: { device: service.car }, $unset: { car: "" } },
    );
    migratedServices += 1;
  }

  console.log(`Device records copied or already present: ${migratedDevices}`);
  console.log(`Service records linked to devices: ${migratedServices}`);
  console.log("The original cars collection was preserved; verify the migrated data before removing it.");

  await mongoose.disconnect();
};

migrate().catch(async (error) => {
  console.error("Device data migration failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
