import express from 'express';
import {
  createDevice,
  getAllDevices,
  getDeviceById,
  deleteDevice,
  updateDevice
} from '../controllers/device.controller.js';
import upload from '../middleware/upload.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { cacheTtl, responseCache, invalidateUserCache } from '../middleware/responseCache.js';

const router = express.Router();

router.use(requireAuth, invalidateUserCache);


router.post('/', upload.single('image'), createDevice);
router.get('/', responseCache({ namespace: 'devices:list', ttlSeconds: cacheTtl('DEVICES', 30) }), getAllDevices);
router.get('/:id', responseCache({ namespace: 'devices:item', ttlSeconds: cacheTtl('DEVICES', 30) }), getDeviceById);
router.delete('/:id', deleteDevice);
router.put('/:id', upload.single('image'), updateDevice);


export default router;
