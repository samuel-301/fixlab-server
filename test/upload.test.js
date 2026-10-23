import test from "node:test";
import assert from "node:assert/strict";
import { imageFileFilter, uploadLimits } from "../middleware/upload.js";

const checkFile = (mimetype) => new Promise((resolve, reject) => {
  imageFileFilter({}, { mimetype }, (error, accepted) => error ? reject(error) : resolve(accepted));
});

test("image upload accepts JPEG, PNG, and WebP files", async () => {
  for (const mimetype of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(await checkFile(mimetype), true);
  }
});

test("image upload rejects unsupported file types", async () => {
  await assert.rejects(checkFile("application/pdf"), /Only JPEG, PNG, and WebP images are allowed/);
});

test("image upload allows one file up to 8 MiB", () => {
  assert.deepEqual(uploadLimits, { fileSize: 8 * 1024 * 1024, files: 1 });
});
