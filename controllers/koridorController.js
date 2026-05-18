import pool from '../config/db.js'

// GET /api/koridor?armada_id=X
export const getAllKoridor = async (req, res) => {
  const { role: callerRole, armada_id: callerArmadaId } = req.user

  let effectiveArmadaId
  if (callerRole === 'super_admin') {
    effectiveArmadaId = req.query.armada_id ? parseInt(req.query.armada_id) : null
  } else {
    effectiveArmadaId = callerArmadaId
  }

  try {
    let query = `
      SELECT k.koridor_id, k.nama_koridor, k.tipe, k.armada_id,
             a.kode_armada, a.nama_armada
      FROM koridor k
      LEFT JOIN armada a ON k.armada_id = a.armada_id
    `
    const params = []
    if (effectiveArmadaId) {
      query += ' WHERE k.armada_id = $1'
      params.push(effectiveArmadaId)
    }
    query += ' ORDER BY a.kode_armada, k.nama_koridor'

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error('Get all koridor error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// POST /api/koridor
export const createKoridor = async (req, res) => {
  const { role: callerRole, armada_id: callerArmadaId } = req.user
  const { nama_koridor, tipe } = req.body
  let { armada_id } = req.body

  if (callerRole !== 'super_admin') {
    armada_id = callerArmadaId
  }

  if (!nama_koridor || !tipe || !armada_id) {
    return res.status(400).json({ message: 'Nama koridor, tipe, dan armada wajib diisi' })
  }

  if (!['koridor', 'feeder'].includes(tipe)) {
    return res.status(400).json({ message: 'Tipe harus koridor atau feeder' })
  }

  try {
    const result = await pool.query(
      `INSERT INTO koridor (nama_koridor, tipe, armada_id)
       VALUES ($1, $2, $3)
       RETURNING koridor_id, nama_koridor, tipe, armada_id`,
      [nama_koridor, tipe, armada_id]
    )
    res.status(201).json({ message: 'Koridor berhasil ditambahkan', koridor: result.rows[0] })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Nama koridor sudah digunakan pada armada ini' })
    }
    console.error('Create koridor error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// PUT /api/koridor/:id
export const updateKoridor = async (req, res) => {
  const { id } = req.params
  const { role: callerRole, armada_id: callerArmadaId } = req.user
  const { nama_koridor, tipe, armada_id } = req.body

  // Admin vendor hanya bisa edit koridor di armadanya
  if (callerRole !== 'super_admin') {
    const check = await pool.query('SELECT armada_id FROM koridor WHERE koridor_id = $1', [id])
    if (check.rows.length === 0) return res.status(404).json({ message: 'Koridor tidak ditemukan' })
    if (check.rows[0].armada_id !== callerArmadaId) return res.status(403).json({ message: 'Akses ditolak' })
  }

  const fields = []
  const values = []
  let idx = 1

  if (nama_koridor !== undefined) { fields.push(`nama_koridor = $${idx++}`); values.push(nama_koridor) }
  if (tipe !== undefined) {
    if (!['koridor', 'feeder'].includes(tipe)) {
      return res.status(400).json({ message: 'Tipe harus koridor atau feeder' })
    }
    fields.push(`tipe = $${idx++}`)
    values.push(tipe)
  }
  if (armada_id !== undefined && callerRole === 'super_admin') {
    fields.push(`armada_id = $${idx++}`)
    values.push(armada_id)
  }

  if (fields.length === 0) {
    return res.status(400).json({ message: 'Tidak ada field yang diupdate' })
  }

  values.push(id)

  try {
    const result = await pool.query(
      `UPDATE koridor SET ${fields.join(', ')} WHERE koridor_id = $${idx}
       RETURNING koridor_id, nama_koridor, tipe, armada_id`,
      values
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Koridor tidak ditemukan' })
    }

    res.json({ message: 'Koridor berhasil diupdate', koridor: result.rows[0] })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Nama koridor sudah digunakan pada armada ini' })
    }
    console.error('Update koridor error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// DELETE /api/koridor/:id
export const deleteKoridor = async (req, res) => {
  const { id } = req.params
  const { role: callerRole, armada_id: callerArmadaId } = req.user

  try {
    const check = await pool.query('SELECT armada_id FROM koridor WHERE koridor_id = $1', [id])
    if (check.rows.length === 0) return res.status(404).json({ message: 'Koridor tidak ditemukan' })

    if (callerRole !== 'super_admin' && check.rows[0].armada_id !== callerArmadaId) {
      return res.status(403).json({ message: 'Akses ditolak' })
    }

    // Cek apakah koridor masih dipakai driver
    const usedCheck = await pool.query('SELECT driver_id FROM driver WHERE koridor_id = $1 LIMIT 1', [id])
    if (usedCheck.rows.length > 0) {
      return res.status(409).json({ message: 'Koridor tidak bisa dihapus karena masih digunakan oleh driver' })
    }

    await pool.query('DELETE FROM koridor WHERE koridor_id = $1', [id])
    res.json({ message: 'Koridor berhasil dihapus' })
  } catch (err) {
    console.error('Delete koridor error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}
