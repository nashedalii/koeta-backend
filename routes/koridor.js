import express from 'express'
import { getAllKoridor, createKoridor, updateKoridor, deleteKoridor } from '../controllers/koridorController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'

const router = express.Router()

router.get('/', authenticate, authorize('super_admin', 'admin', 'petugas', 'driver'), getAllKoridor)
router.post('/', authenticate, authorize('super_admin', 'admin'), createKoridor)
router.put('/:id', authenticate, authorize('super_admin', 'admin'), updateKoridor)
router.delete('/:id', authenticate, authorize('super_admin', 'admin'), deleteKoridor)

export default router
