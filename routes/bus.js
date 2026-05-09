import express from 'express'
import { getAllBus, createBus, updateBus, deleteBus } from '../controllers/busController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'

const router = express.Router()

router.get('/', authenticate, authorize('super_admin', 'admin'), getAllBus)
router.post('/', authenticate, authorize('super_admin', 'admin'), createBus)
router.put('/:id', authenticate, authorize('super_admin', 'admin'), updateBus)
router.delete('/:id', authenticate, authorize('super_admin', 'admin'), deleteBus)

export default router
