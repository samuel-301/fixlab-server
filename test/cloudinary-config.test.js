import test from "node:test";
import assert from "node:assert/strict";
import { uploadImage } from "../config/cloudinary.js";

test("Cloudinary upload reports missing server configuration clearly", async () => {
  const names = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  try {
    await assert.rejects(
      uploadImage({ mimetype: "image/png", buffer: Buffer.from("image") }, "profiles"),
      { code: "CLOUDINARY_CONFIG_MISSING", message: /CLOUDINARY_CLOUD_NAME.*CLOUDINARY_API_KEY.*CLOUDINARY_API_SECRET/ },
    );
  } finally {
    names.forEach((name) => {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    });
  }
});
