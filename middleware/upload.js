import multer from "multer";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
export const imageFileFilter = (_req, file, cb) => {
  if (allowedTypes.has(file.mimetype)) return cb(null, true);
  cb(new Error("Only JPEG, PNG, and WebP images are allowed."));
};
export const uploadLimits = Object.freeze({ fileSize: 8 * 1024 * 1024, files: 1 });

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFileFilter,
  limits: uploadLimits,
});

export default upload;
