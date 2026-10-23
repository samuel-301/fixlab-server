import { v2 as cloudinary } from "cloudinary";
import { randomUUID } from "node:crypto";

const required = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
let configured = false;

const configureCloudinary = () => {
  if (configured) return;
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    const error = new Error(`Cloudinary is not configured. Missing: ${missing.join(", ")}`);
    error.code = "CLOUDINARY_CONFIG_MISSING";
    throw error;
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key: process.env.CLOUDINARY_API_KEY.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET.trim(),
    secure: true,
  });
  configured = true;
};

const folderFor = (category) => {
  if (category !== "profiles" && category !== "devices") throw new Error("Unsupported image category.");
  const base = (process.env.CLOUDINARY_FOLDER || "fixlab").trim().replace(/^\/+|\/+$/g, "");
  if (!base) throw new Error("CLOUDINARY_FOLDER must not be empty.");
  return `${base}/${category}`;
};

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export const uploadImage = async (file, category) => {
  if (!file) return null;
  if (!allowedMimeTypes.has(file.mimetype)) throw new Error("Only JPEG, PNG, and WebP images are allowed.");
  configureCloudinary();
  const folder = folderFor(category);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: "image",
      folder,
      public_id: randomUUID(),
      overwrite: false,
    }, (error, result) => {
      if (error) {
        const safeError = new Error("Cloudinary image upload failed.");
        safeError.code = "CLOUDINARY_UPLOAD_FAILED";
        safeError.cause = error;
        reject(safeError);
      } else resolve({ publicId: result.public_id, url: result.secure_url });
    });
    stream.end(file.buffer);
  });
};

// Only call with public IDs read from a trusted MongoDB record.
export const deleteCloudinaryImage = async (publicId) => {
  if (typeof publicId !== "string" || !publicId) return;
  configureCloudinary();
  const result = await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
  if (result.result !== "ok" && result.result !== "not found") {
    const error = new Error("Cloudinary image deletion failed.");
    error.code = "CLOUDINARY_DELETE_FAILED";
    throw error;
  }
};

export const getDeviceWithImageUrl = async (device) => {
  const result = typeof device?.toObject === "function" ? device.toObject() : { ...device };
  delete result.imagePublicId;
  return result;
};

export const getUserWithImageUrl = async (user) => {
  const result = typeof user?.toObject === "function" ? user.toObject() : { ...user };
  delete result.password;
  delete result.profileImagePublicId;
  return result;
};
