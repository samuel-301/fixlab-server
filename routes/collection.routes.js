import express from 'express';
import {
  createCollection,
  getAllCollections,
  getCollectionById,
  deleteCollection,
  updateCollection
} from '../controllers/collection.controller.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { cacheTtl, responseCache, invalidateUserCache } from '../middleware/responseCache.js';

const router = express.Router();

router.use(requireAuth, invalidateUserCache);


router.post('/', createCollection);
router.get('/', responseCache({ namespace: 'collections:list', ttlSeconds: cacheTtl('COLLECTIONS', 60) }), getAllCollections);
router.get('/:id', responseCache({ namespace: 'collections:item', ttlSeconds: cacheTtl('COLLECTIONS', 60) }), getCollectionById);
router.delete('/:id', deleteCollection);
router.put('/:id', updateCollection);


export default router;
