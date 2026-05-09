import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import pool from './config/db.js'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/user.js'
import busRoutes from './routes/bus.js'
import siklusRoutes from './routes/siklus.js'
import periodeRoutes from './routes/periode.js'
import bobotRoutes from './routes/bobot.js'
import penilaianRoutes from './routes/penilaian.js'
import validasiRoutes from './routes/validasi.js'
import rankingRoutes from './routes/ranking.js'
import driverRoutes from './routes/driver.js'
import dashboardRoutes from './routes/dashboard.js'
import profileRoutes from './routes/profile.js'
import resetRequestRoutes from './routes/resetRequest.js'
import { authenticate, authorize } from './middleware/authMiddleware.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/bus', busRoutes)
app.use('/api/siklus', siklusRoutes)
app.use('/api/periode', periodeRoutes)
app.use('/api/bobot', bobotRoutes)
app.use('/api/penilaian', penilaianRoutes)
app.use('/api/validasi', validasiRoutes)
app.use('/api/ranking', rankingRoutes)
app.use('/api/driver',    driverRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/profile',  profileRoutes)
app.use('/api/reset-request', resetRequestRoutes)

// GET /api/armada — daftar armada untuk filter (super_admin)
app.get('/api/armada', authenticate, authorize('super_admin', 'admin', 'petugas', 'driver'), async (req, res) => {
  try {
    const result = await pool.query('SELECT armada_id, kode_armada, nama_armada FROM armada ORDER BY kode_armada')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
})

// GET /api/koridor?armada_id=X — daftar koridor/feeder per armada
app.get('/api/koridor', authenticate, authorize('super_admin', 'admin', 'petugas', 'driver'), async (req, res) => {
  try {
    const { armada_id } = req.query
    let query = 'SELECT koridor_id, nama_koridor, tipe, armada_id FROM koridor'
    const params = []
    if (armada_id) {
      query += ' WHERE armada_id = $1'
      params.push(armada_id)
    }
    query += ' ORDER BY nama_koridor'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
})

// Test protected route
app.get('/api/test-auth', authenticate, (req, res) => {
  res.json({ message: 'Token valid', user: req.user })
})

app.get('/api/test-admin', authenticate, authorize('admin'), (req, res) => {
  res.json({ message: 'Hanya admin yang bisa akses ini', user: req.user })
})

// Test koneksi database
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS time')
    res.json({ success: true, time: result.rows[0].time })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`)
})
