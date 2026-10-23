import Device from "../models/Device.js";
import path from "node:path";
import fs from "node:fs";
import { logActivity } from "../utils/logActivity.js";
import { deleteCloudinaryImage, getDeviceWithImageUrl, uploadImage } from "../config/cloudinary.js";

const removeLegacyLocalImage = (image) => {
  if (typeof image !== "string" || !image.startsWith("/uploads/")) return;
  const base = path.basename(image);
  const candidates = [
    path.join(process.cwd(), "uploads", base),
    path.join(process.cwd(), "uploads", "profiles", base),
  ];
  for (const filePath of candidates) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
};

// Create device with image and user
export const createDevice = async (req, res) => {
  let uploadedImage;
  try {
    uploadedImage = req.file ? await uploadImage(req.file, "devices") : null;
    const deviceData = { ...req.body };
    delete deviceData.image;
    delete deviceData.imagePublicId;
    delete deviceData.createdBy;
    const newDevice = await Device.create({
      ...deviceData,
      image: uploadedImage?.url || null,
      imagePublicId: uploadedImage?.publicId,
      createdBy: req.user._id,
    });

    await logActivity({
      user: req.user._id,
      action: "create",
      resourceType: "device",
      resourceId: newDevice._id,
      message: `Created device ${newDevice.serialNumberOrIMEI}`,
    });

    res.status(201).json(await getDeviceWithImageUrl(newDevice));
  } catch (err) {
    if (uploadedImage?.publicId) await deleteCloudinaryImage(uploadedImage.publicId).catch(() => {});
    console.error("Device creation failed", { code: err.code, name: err.name });
    res.status(err.code === "CLOUDINARY_CONFIG_MISSING" ? 503 : 500).json({ message: err.code === "CLOUDINARY_CONFIG_MISSING" ? err.message : "Error creating device", code: err.code });
  }
};

export const getAllDevices = async (req, res) => {
  try {
    const devices = await Device.find({ createdBy: req.user._id }).sort({ createdAt: -1 });
    res.json(await Promise.all(devices.map(getDeviceWithImageUrl)));
  } catch (err) {
    res.status(500).json({ message: "Error fetching devices", error: err.message });
  }
};

export const getDeviceById = async (req, res) => {
  try {
    const device = await Device.findOne({ _id: req.params.id, createdBy: req.user._id });
    if (!device) return res.status(404).json({ message: "Device not found" });
    res.json(await getDeviceWithImageUrl(device));
  } catch (err) {
    res.status(500).json({ message: "Error fetching device", error: err.message });
  }
};

export const updateDevice = async (req, res) => {
  let uploadedImage;
  try {
    const updateData = { ...req.body };
    delete updateData.image;
    delete updateData.imagePublicId;
    delete updateData.createdBy;
    const existing = await Device.findOne({ _id: req.params.id, createdBy: req.user._id });
    if (!existing) return res.status(404).json({ message: "Device not found or not authorized" });

    if (req.file) {
      uploadedImage = await uploadImage(req.file, "devices");
      updateData.image = uploadedImage.url;
      updateData.imagePublicId = uploadedImage.publicId;
    }
    const updatedDevice = await Device.findOneAndUpdate(
      { _id: req.params.id, createdBy: req.user._id },
      updateData,
      { new: true, runValidators: true },
    );
    if (req.file && existing.imagePublicId) {
      try { await deleteCloudinaryImage(existing.imagePublicId); }
      catch (error) { console.warn("Unable to remove replaced Cloudinary device image", { code: error.code, name: error.name }); }
    }

    await logActivity({
      user: req.user._id,
      action: "update",
      resourceType: "device",
      resourceId: updatedDevice._id,
      message: `Updated device ${updatedDevice.serialNumberOrIMEI}`,
    });
    res.json(await getDeviceWithImageUrl(updatedDevice));
  } catch (err) {
    if (uploadedImage?.publicId) {
      try { await deleteCloudinaryImage(uploadedImage.publicId); } catch {}
    }
    console.error("Device update failed", { code: err.code, name: err.name });
    res.status(err.code === "CLOUDINARY_CONFIG_MISSING" ? 503 : 500).json({ message: err.code === "CLOUDINARY_CONFIG_MISSING" ? err.message : "Error updating device", code: err.code });
  }
};

export const deleteDevice = async (req, res) => {
  try {
    const device = await Device.findOneAndDelete({ _id: req.params.id, createdBy: req.user._id });
    if (!device) return res.status(404).json({ message: "Device not found or not authorized" });

    try { await deleteCloudinaryImage(device.imagePublicId); }
    catch (error) { console.warn("Unable to remove deleted Cloudinary device image", { code: error.code, name: error.name }); }
    removeLegacyLocalImage(device.image);

    await logActivity({
      user: req.user._id,
      action: "delete",
      resourceType: "device",
      resourceId: device._id,
      message: `Deleted device ${device.serialNumberOrIMEI}`,
    });
    res.json({ message: "Device deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting device", error: err.message });
  }
};
