import express from 'express'
import {
  getAllValidasi,
  getValidasiById,
  approvePenilaian,
  rejectPenilaian
} from '../controllers/validasiController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'

const router = express.Router()

router.get('/',            authenticate, authorize('super_admin', 'admin'), getAllValidasi)
router.get('/:id',         authenticate, authorize('super_admin', 'admin'), getValidasiById)
router.put('/:id/approve', authenticate, authorize('super_admin', 'admin'), approvePenilaian)
router.put('/:id/reject',  authenticate, authorize('super_admin', 'admin'), rejectPenilaian)

export default router
