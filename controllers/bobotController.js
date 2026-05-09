import pool from '../config/db.js'

// ── GET /api/bobot?siklus_id= ─────────────────────────────────────────────
export const getAllBobot = async (req, res) => {
  const { siklus_id } = req.query

  if (!siklus_id) {
    return res.status(400).json({ message: 'siklus_id wajib diisi' })
  }

  try {
    const result = await pool.query(
      `SELECT bobot_id, nama_bobot, persentase_bobot, deskripsi, status_aktif
       FROM bobot
       WHERE siklus_id = $1
       ORDER BY bobot_id`,
      [siklus_id]
    )

    const total = result.rows.reduce((sum, b) => sum + parseFloat(b.persentase_bobot), 0)

    res.json({
      bobots: result.rows,
      total_persentase: parseFloat(total.toFixed(2))
    })
  } catch (err) {
    console.error('Get all bobot error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── PUT /api/bobot/:id/deskripsi ─────────────────────────────────────────
// Update rubric penilaian untuk satu bobot
export const updateBobotDeskripsi = async (req, res) => {
  const { id } = req.params
  const { deskripsi } = req.body

  if (!Array.isArray(deskripsi) || deskripsi.length === 0) {
    return res.status(400).json({ message: 'deskripsi harus berupa array rubric yang tidak kosong' })
  }

  for (const item of deskripsi) {
    if (!item.range || !item.deskripsi) {
      return res.status(400).json({ message: 'Setiap rubric harus memiliki field range dan deskripsi' })
    }
  }

  try {
    const result = await pool.query(
      `UPDATE bobot SET deskripsi = $1 WHERE bobot_id = $2
       RETURNING bobot_id, nama_bobot, persentase_bobot, deskripsi`,
      [JSON.stringify(deskripsi), id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Bobot tidak ditemukan' })
    }

    res.json({
      message: 'Rubric berhasil disimpan',
      bobot: result.rows[0]
    })
  } catch (err) {
    console.error('Update bobot deskripsi error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── PUT /api/bobot/bulk ───────────────────────────────────────────────────
// Ganti semua bobot dalam satu siklus sekaligus
export const bulkUpdateBobot = async (req, res) => {
  const { siklus_id, data } = req.body
  const admin_id = req.user.user_id

  // Validasi input
  if (!siklus_id) {
    return res.status(400).json({ message: 'siklus_id wajib diisi' })
  }
  if (!Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ message: 'data bobot tidak boleh kosong' })
  }
  for (const item of data) {
    if (!item.nama_bobot || item.persentase_bobot === undefined) {
      return res.status(400).json({ message: 'Setiap bobot harus memiliki nama_bobot dan persentase_bobot' })
    }
    if (item.persentase_bobot <= 0 || item.persentase_bobot > 100) {
      return res.status(400).json({ message: `Persentase "${item.nama_bobot}" harus antara 1 dan 100` })
    }
  }

  // Validasi total = 100
  const total = data.reduce((sum, item) => sum + parseFloat(item.persentase_bobot), 0)
  if (Math.abs(total - 100) > 0.01) {
    return res.status(400).json({
      message: `Total persentase harus 100%. Saat ini: ${total.toFixed(2)}%`
    })
  }

  const client = await pool.connect()
  try {
    // Cek siklus ada
    const siklusCheck = await client.query(
      'SELECT 1 FROM siklus_penilaian WHERE siklus_id = $1', [siklus_id]
    )
    if (siklusCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Siklus tidak ditemukan' })
    }

    // Cek apakah sudah ada penilaian yang disubmit dalam siklus ini
    const usedCheck = await client.query(
      `SELECT 1 FROM penilaian pn
       JOIN periode p ON pn.periode_id = p.periode_id
       WHERE p.siklus_id = $1
       LIMIT 1`,
      [siklus_id]
    )
    if (usedCheck.rows.length > 0) {
      return res.status(409).json({
        message: 'Bobot tidak bisa diubah karena sudah ada penilaian yang disubmit dalam siklus ini'
      })
    }

    await client.query('BEGIN')

    // Hapus semua bobot lama dalam siklus ini
    await client.query('DELETE FROM bobot WHERE siklus_id = $1', [siklus_id])

    // Insert semua bobot baru
    for (const item of data) {
      await client.query(
        `INSERT INTO bobot (nama_bobot, persentase_bobot, deskripsi, siklus_id, admin_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [item.nama_bobot, item.persentase_bobot, item.deskripsi || null, siklus_id, admin_id]
      )
    }

    await client.query('COMMIT')

    res.json({
      message: `${data.length} bobot berhasil disimpan`,
      jumlah_bobot: data.length,
      total_persentase: 100
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Bulk update bobot error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  } finally {
    client.release()
  }
}
