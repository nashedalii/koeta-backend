import express from 'express'
import { getMyProfile, getMyPenilaian, getMyRanking } from '../controllers/driverController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'

const router = express.Router()

router.get('/me',         authenticate, authorize('driver'), getMyProfile)
router.get('/me/penilaian', authenticate, authorize('driver'), getMyPenilaian)
router.get('/me/ranking',   authenticate, authorize('driver'), getMyRanking)

export default router
