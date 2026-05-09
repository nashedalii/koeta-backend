import express from 'express'
import { getRanking, getDriverDetail } from '../controllers/rankingController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'

const router = express.Router()

router.get('/',                authenticate, authorize('super_admin', 'admin', 'petugas', 'driver'), getRanking)
router.get('/driver/:driver_id', authenticate, authorize('super_admin', 'admin', 'petugas', 'driver'), getDriverDetail)

export default router
