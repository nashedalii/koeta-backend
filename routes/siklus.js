import express from 'express'
import { getAllSiklus, getSiklusById, createSiklus, deleteSiklus } from '../controllers/siklusController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'

const router = express.Router()

// Semua admin bisa baca siklus; hanya super_admin bisa buat/hapus
router.get('/',    authenticate, authorize('super_admin', 'admin', 'petugas', 'driver'), getAllSiklus)
router.get('/:id', authenticate, authorize('super_admin', 'admin', 'petugas', 'driver'), getSiklusById)
router.post('/',      authenticate, authorize('super_admin'), createSiklus)
router.delete('/:id', authenticate, authorize('super_admin'), deleteSiklus)

export default router
