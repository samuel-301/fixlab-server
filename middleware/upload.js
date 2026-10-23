import multer from "multer";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (allowedTypes.has(file.mimetype)) return cb(null, true);
    cb(new Error("Only JPEG, PNG, and WebP images are allowed."));
  },
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

export default upload;
