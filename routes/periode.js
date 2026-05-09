import express from 'express'
import { getPeriodeAktif, getAllPeriode, setOverridePeriode } from '../controllers/periodeController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'

const router = express.Router()

router.get('/semua',        authenticate, authorize('super_admin', 'admin'), getAllPeriode)
router.get('/aktif',        authenticate, authorize('super_admin', 'admin', 'petugas'), getPeriodeAktif)
router.put('/:id/override', authenticate, authorize('super_admin'), setOverridePeriode)

export default router
