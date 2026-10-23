import express from "express";
import {
  createPayment,
  deletePayment,
  getAllPayments,
  getDailyReport,
  getInvoice,
  getPaymentById,
} from "../controllers/payment.controller.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { cacheTtl, responseCache, invalidateUserCache } from "../middleware/responseCache.js";

const router = express.Router();

router.use(requireAuth, invalidateUserCache);

router.post("/", createPayment);
router.get("/", responseCache({ namespace: "payments:list", ttlSeconds: cacheTtl("PAYMENTS", 15) }), getAllPayments);
router.get("/:id/invoice", getInvoice);
router.get("/:id", responseCache({ namespace: "payments:item", ttlSeconds: cacheTtl("PAYMENTS", 15) }), getPaymentById);
router.delete("/:id", deletePayment);

export default router;
