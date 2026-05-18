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
  const { role, armada_id } = req.user
  const isSuperAdmin = role === 'super_admin'

  try {
    let query
    let params = []

    if (isSuperAdmin) {
      // Super admin: lihat semua request
      query = `
        SELECT rr.request_id, rr.username, rr.role, rr.nomor_hp, rr.status, rr.created_at, rr.handled_at
        FROM reset_password_request rr
        ORDER BY CASE WHEN rr.status = 'pending' THEN 0 ELSE 1 END, rr.created_at DESC
      `
    } else {
      // Admin vendor: hanya request dari petugas/driver di armadanya
      query = `
        SELECT rr.request_id, rr.username, rr.role, rr.nomor_hp, rr.status, rr.created_at, rr.handled_at
        FROM reset_password_request rr
        WHERE (
          (rr.role = 'petugas' AND EXISTS (
            SELECT 1 FROM petugas p
            WHERE (p.username = rr.username OR p.nomor_pegawai = rr.username)
              AND p.armada_id = $1
          ))
          OR
          (rr.role = 'driver' AND EXISTS (
            SELECT 1 FROM driver d
            WHERE d.username = rr.username
              AND d.armada_id = $1
          ))
        )
        ORDER BY CASE WHEN rr.status = 'pending' THEN 0 ELSE 1 END, rr.created_at DESC
      `
      params = [armada_id]
    }

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error('Get reset requests error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// GET /api/reset-request/count — admin, jumlah pending
export const getPendingCount = async (req, res) => {
  const { role, armada_id } = req.user
  const isSuperAdmin = role === 'super_admin'

  try {
    let result
    if (isSuperAdmin) {
      result = await pool.query(
        "SELECT COUNT(*) FROM reset_password_request WHERE status = 'pending'"
      )
    } else {
      result = await pool.query(
        `SELECT COUNT(*) FROM reset_password_request rr
         WHERE rr.status = 'pending'
           AND (
             (rr.role = 'petugas' AND EXISTS (
               SELECT 1 FROM petugas p
               WHERE (p.username = rr.username OR p.nomor_pegawai = rr.username)
                 AND p.armada_id = $1
             ))
             OR
             (rr.role = 'driver' AND EXISTS (
               SELECT 1 FROM driver d
               WHERE d.username = rr.username AND d.armada_id = $1
             ))
           )`,
        [armada_id]
      )
    }
    res.json({ count: parseInt(result.rows[0].count) })
  } catch (err) {
    res.status(500).json({ count: 0 })
  }
}

// POST /api/reset-request/:id/reset — admin
export const handleReset = async (req, res) => {
  const { id } = req.params
  const admin_id = req.user.user_id
  const { role, armada_id } = req.user
  const isSuperAdmin = role === 'super_admin'

  try {
    const reqData = await pool.query(
      'SELECT * FROM reset_password_request WHERE request_id = $1',
      [id]
    )
    if (reqData.rows.length === 0) {
      return res.status(404).json({ message: 'Request tidak ditemukan' })
    }

    const { username, role: userRole, status, nomor_hp } = reqData.rows[0]

    if (status === 'selesai') {
      return res.status(409).json({ message: 'Request ini sudah diproses sebelumnya' })
    }

    // Admin vendor: validasi bahwa user ini memang di armadanya
    if (!isSuperAdmin) {
      let armadaCheck
      if (userRole === 'petugas') {
        armadaCheck = await pool.query(
          'SELECT 1 FROM petugas WHERE (username = $1 OR nomor_pegawai = $1) AND armada_id = $2',
          [username, armada_id]
        )
      } else {
        armadaCheck = await pool.query(
          'SELECT 1 FROM driver WHERE username = $1 AND armada_id = $2',
          [username, armada_id]
        )
      }
      if (armadaCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Akses ditolak: user tidak berada di armada Anda' })
      }
    }

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let tempPassword = 'TR'
    for (let i = 0; i < 6; i++) {
      tempPassword += chars[Math.floor(Math.random() * chars.length)]
    }

    if (userRole === 'petugas') {
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

    res.json({ message: 'Password berhasil direset', password_baru: tempPassword, username, role: userRole, nomor_hp })
  } catch (err) {
    console.error('Handle reset error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}
