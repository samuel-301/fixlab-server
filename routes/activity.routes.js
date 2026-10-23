// routes/activity.routes.js
import express from "express";
import { getMyActivities } from "../controllers/activity.controller.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { cacheTtl, responseCache } from "../middleware/responseCache.js";

const router = express.Router();
router.get("/", requireAuth, responseCache({ namespace: "activities:list", ttlSeconds: cacheTtl("ACTIVITIES", 10) }), getMyActivities);

export default router;
