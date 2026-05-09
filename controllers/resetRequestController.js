import pool from '../config/db.js'

// POST /api/reset-request — public
export const submitRequest = async (req, res) => {
  const { username, role, nomor_hp } = req.body

  if (!username || !role || !nomor_hp) {
    return res.status(400).json({ message: 'Username, role, dan nomor HP wajib diisi' })
  }
  if (!['petugas', 'driver'].includes(role)) {
    return res.status(400).json({ message: 'Hanya petugas dan driver yang dapat request reset password' })
  }

  try {
    let userCheck
    if (role === 'petugas') {
      userCheck = await pool.query(
        'SELECT petugas_id FROM petugas WHERE username = $1 OR nomor_pegawai = $1',
        [username]
      )
    } else {
      userCheck = await pool.query(
        'SELECT driver_id FROM driver WHERE username = $1',
        [username]
      )
    }

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Username tidak ditemukan' })
    }

    const existing = await pool.query(
      "SELECT 1 FROM reset_password_request WHERE username = $1 AND role = $2 AND status = 'pending'",
      [username, role]
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Permintaan reset password Anda sudah terkirim, harap tunggu admin memproses' })
    }

    await pool.query(
      'INSERT INTO reset_password_request (username, role, nomor_hp) VALUES ($1, $2, $3)',
      [username, role, nomor_hp]
    )

    res.json({ message: 'Permintaan berhasil dikirim. Admin akan segera memproses dan menghubungi Anda.' })
  } catch (err) {
    console.error('Submit reset request error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// GET /api/reset-request — admin
export const getRequests = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT request_id, username, role, nomor_hp, status, created_at, handled_at
       FROM reset_password_request
       ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at DESC`
    )
    res.json(result.rows)
  } catch (err) {
    console.error('Get reset requests error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// GET /api/reset-request/count — admin, jumlah pending
export const getPendingCount = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) FROM reset_password_request WHERE status = 'pending'"
    )
    res.json({ count: parseInt(result.rows[0].count) })
  } catch (err) {
    res.status(500).json({ count: 0 })
  }
}

// POST /api/reset-request/:id/reset — admin
export const handleReset = async (req, res) => {
  const { id } = req.params
  const admin_id = req.user.user_id

  try {
    const reqData = await pool.query(
      'SELECT * FROM reset_password_request WHERE request_id = $1',
      [id]
    )
    if (reqData.rows.length === 0) {
      return res.status(404).json({ message: 'Request tidak ditemukan' })
    }

    const { username, role, status, nomor_hp } = reqData.rows[0]

    if (status === 'selesai') {
      return res.status(409).json({ message: 'Request ini sudah diproses sebelumnya' })
    }

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let tempPassword = 'TR'
    for (let i = 0; i < 6; i++) {
      tempPassword += chars[Math.floor(Math.random() * chars.length)]
    }

    if (role === 'petugas') {
      await pool.query(
        "UPDATE petugas SET password = crypt($1, gen_salt('bf')) WHERE username = $2 OR nomor_pegawai = $2",
        [tempPassword, username]
      )
    } else {
      await pool.query(
        "UPDATE driver SET password = crypt($1, gen_salt('bf')) WHERE username = $2",
        [tempPassword, username]
      )
    }

    await pool.query(
      "UPDATE reset_password_request SET status = 'selesai', admin_id = $1, handled_at = NOW() WHERE request_id = $2",
      [admin_id, id]
    )

    res.json({ message: 'Password berhasil direset', password_baru: tempPassword, username, role, nomor_hp })
  } catch (err) {
    console.error('Handle reset error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}
