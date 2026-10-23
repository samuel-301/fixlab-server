import express from "express";
import {
  createServiceCollection,
  getAllServiceCollections,
  getServiceCollectionById,
  updateServiceCollection,
  deleteServiceCollection,
} from "../controllers/serviceCollection.controller.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { cacheTtl, responseCache, invalidateUserCache } from "../middleware/responseCache.js";

const router = express.Router();

router.use(requireAuth, invalidateUserCache);

router.post("/", createServiceCollection);
router.get("/", responseCache({ namespace: "services:list", ttlSeconds: cacheTtl("SERVICES", 15) }), getAllServiceCollections);
router.get("/:id", responseCache({ namespace: "services:item", ttlSeconds: cacheTtl("SERVICES", 15) }), getServiceCollectionById);
router.put("/:id", updateServiceCollection);
router.delete("/:id", deleteServiceCollection);

export default router;
