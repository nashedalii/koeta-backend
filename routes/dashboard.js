import express from 'express'
import { getAdminDashboard, getPetugasDashboard, getTop5 } from '../controllers/dashboardController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'

const router = express.Router()

router.get('/admin',   authenticate, authorize('super_admin', 'admin'), getAdminDashboard)
router.get('/top5',    authenticate, authorize('super_admin', 'admin'), getTop5)
router.get('/petugas', authenticate, authorize('petugas'), getPetugasDashboard)

export default router
