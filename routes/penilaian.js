import express from 'express'
import {
  createPenilaian,
  getAllPenilaian,
  getPenilaianById,
  updatePenilaian,
  deletePenilaian,
  uploadFoto,
  deleteFoto
} from '../controllers/penilaianController.js'
import { authenticate, authorize } from '../middleware/authMiddleware.js'
import upload from '../middleware/upload.js'

const router = express.Router()

// Semua route penilaian hanya untuk petugas
router.post('/',    authenticate, authorize('petugas'), createPenilaian)
router.get('/',     authenticate, authorize('petugas'), getAllPenilaian)
router.get('/:id',  authenticate, authorize('petugas'), getPenilaianById)
router.put('/:id',  authenticate, authorize('petugas'), updatePenilaian)
router.delete('/:id', authenticate, authorize('petugas'), deletePenilaian)

// Foto
router.post('/:id/foto', authenticate, authorize('petugas'), upload.single('foto'), uploadFoto)
router.delete('/foto/:buktiId', authenticate, authorize('petugas'), deleteFoto)

export default router
