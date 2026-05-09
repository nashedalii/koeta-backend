import express from 'express'
import { getAllBobot, bulkUpdateBobot, updateBobotDeskripsi } from '../controllers/bobotController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'

const router = express.Router()

router.get('/',              authenticate, authorize('super_admin', 'admin', 'petugas'), getAllBobot)
router.put('/bulk',          authenticate, authorize('super_admin'), bulkUpdateBobot)
router.put('/:id/deskripsi', authenticate, authorize('super_admin'), updateBobotDeskripsi)

export default router
