import express from 'express'
import { getMyProfile, updateMyProfile, updateMyFoto, deleteMyFoto, updateMyPassword } from '../controllers/profileController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'
import upload from '../middleware/upload.js'

const router = express.Router()

// Semua route hanya untuk petugas & driver
const allowedRoles = authorize('petugas', 'driver')

router.get('/me',           authenticate, allowedRoles, getMyProfile)
router.put('/me',           authenticate, allowedRoles, updateMyProfile)
router.put('/me/foto',      authenticate, allowedRoles, upload.single('foto'), updateMyFoto)
router.delete('/me/foto',   authenticate, allowedRoles, deleteMyFoto)
router.put('/me/password',  authenticate, allowedRoles, updateMyPassword)

export default router
