import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";
import { generateInvoicePDF } from "../utils/generateInvoicePDF.js";

const payment = {
  _id: "payment-test-123",
  paymentNumber: "PAY-123",
  paymentDate: "2026-10-20T10:00:00.000Z",
  amountPaid: 25000,
  user: { username: "tester" },
  serviceCollection: {
    device: { serialNumberOrIMEI: "IMEI-123", deviceName: "Phone", deviceModel: "Model X", customerName: "Customer", phoneNumber: "0780000000" },
    collection: { collectionName: "Screen repair", collectionDescription: "Replace damaged screen" },
  },
};

test("invoice generation writes a PDF and renders the payment and service details", async (t) => {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "invoice-test-"));
  const calls = { html: "", pdf: null, closed: false };
  const page = {
    async setContent(html, options) { calls.html = html; calls.setContentOptions = options; },
    async pdf(options) { calls.pdf = options; await fs.writeFile(options.path, "%PDF-test"); },
  };
  const browser = { async newPage() { return page; }, async close() { calls.closed = true; } };
  t.mock.method(puppeteer, "launch", async () => browser);
  t.after(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  process.chdir(tempDir);
  await fs.mkdir("invoices");

  const outputPath = await generateInvoicePDF(payment);

  assert.equal(outputPath, path.join(tempDir, "invoices", "invoice_payment-test-123.pdf"));
  assert.deepEqual(calls.pdf, { path: outputPath, format: "A4" });
  assert.equal(calls.setContentOptions.waitUntil, "networkidle0");
  for (const detail of ["PAY-123", "tester", "IMEI-123", "Screen repair", "25000 RWF"]) assert.match(calls.html, new RegExp(detail));
  assert.equal(await fs.readFile(outputPath, "utf8"), "%PDF-test");
  assert.equal(calls.closed, true);
});
