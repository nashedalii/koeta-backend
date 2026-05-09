import express from 'express'
import { submitRequest, getRequests, getPendingCount, handleReset } from '../controllers/resetRequestController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'

const router = express.Router()

router.post('/', submitRequest)
router.get('/count', authenticate, authorize('super_admin', 'admin'), getPendingCount)
router.get('/', authenticate, authorize('super_admin', 'admin'), getRequests)
router.post('/:id/reset', authenticate, authorize('super_admin', 'admin'), handleReset)

export default router
