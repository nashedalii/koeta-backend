import express from 'express'
import {
  createAdmin, createPetugas, createDriver,
  resetAdminPassword, resetPetugasPassword, resetDriverPassword,
  getAllUsers, getAllDrivers, updateUser, deleteUser
} from '../controllers/userController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'

const router = express.Router()

// ── GET ──────────────────────────────────────────────────────────────
// /driver harus sebelum /:role/:id agar tidak tertangkap sebagai param
router.get('/driver', authenticate, authorize('super_admin', 'admin', 'petugas'), getAllDrivers)
router.get('/', authenticate, authorize('super_admin', 'admin'), getAllUsers)

// ── POST (Create) ─────────────────────────────────────────────────────
router.post('/admin',   authenticate, authorize('super_admin'), createAdmin)
router.post('/petugas', authenticate, authorize('super_admin', 'admin'), createPetugas)
router.post('/driver',  authenticate, authorize('super_admin', 'admin'), createDriver)

// ── PUT (Update & Reset Password) ─────────────────────────────────────
router.put('/:role/:id/reset-password', authenticate, authorize('super_admin', 'admin'), (req, res, next) => {
  const { role } = req.params
  if (role === 'admin')   return resetAdminPassword(req, res, next)
  if (role === 'petugas') return resetPetugasPassword(req, res, next)
  if (role === 'driver')  return resetDriverPassword(req, res, next)
  res.status(400).json({ message: 'Role tidak valid' })
})
router.put('/:role/:id', authenticate, authorize('super_admin', 'admin'), updateUser)

// ── DELETE ────────────────────────────────────────────────────────────
router.delete('/:role/:id', authenticate, authorize('super_admin', 'admin'), deleteUser)

export default router
