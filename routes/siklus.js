import express from 'express'
import { getAllSiklus, getSiklusById, createSiklus, deleteSiklus, activateSiklus, getSiklusMendatang } from '../controllers/siklusController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'

const router = express.Router()

// Semua admin bisa baca siklus; hanya super_admin bisa buat/hapus/aktifkan
router.get('/mendatang', authenticate, authorize('super_admin', 'admin', 'petugas', 'driver'), getSiklusMendatang)
router.get('/',    authenticate, authorize('super_admin', 'admin', 'petugas', 'driver'), getAllSiklus)
router.get('/:id', authenticate, authorize('super_admin', 'admin', 'petugas', 'driver'), getSiklusById)
router.post('/',      authenticate, authorize('super_admin'), createSiklus)
router.put('/:id/activate', authenticate, authorize('super_admin'), activateSiklus)
router.delete('/:id', authenticate, authorize('super_admin'), deleteSiklus)

export default router
