import pool from '../config/db.js'

// ── PUT /api/periode/:id/override ────────────────────────────────────────
// Toggle override: aktifkan periode dipilih, atau matikan jika sudah aktif
export const setOverridePeriode = async (req, res) => {
  const { id } = req.params

  try {
    // 1. Ambil data periode
    const periodeResult = await pool.query(
      'SELECT * FROM periode WHERE periode_id = $1', [id]
    )
    if (periodeResult.rows.length === 0) {
      return res.status(404).json({ message: 'Periode tidak ditemukan' })
    }
    const periode = periodeResult.rows[0]

    // 2. Jika sudah override aktif → toggle off (kembali ke auto)
    if (periode.is_override) {
      await pool.query(
        'UPDATE periode SET is_override = false WHERE periode_id = $1', [id]
      )
      return res.json({ message: 'Override dinonaktifkan, periode aktif kembali ke otomatis' })
    }

    // 3. Validasi: tidak boleh override periode masa depan
    const futureCheck = await pool.query(
      'SELECT 1 FROM periode WHERE periode_id = $1 AND tanggal_mulai > CURRENT_DATE',
      [id]
    )
    if (futureCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Tidak bisa mengaktifkan periode yang belum dimulai' })
    }

    // 4. Reset semua override dalam siklus yang sama
    await pool.query(
      'UPDATE periode SET is_override = false WHERE siklus_id = $1', [periode.siklus_id]
    )

    // 5. Set override pada periode yang dipilih
    await pool.query(
      'UPDATE periode SET is_override = true WHERE periode_id = $1', [id]
    )

    res.json({
      message: `Periode ${periode.nama_periode} berhasil diset sebagai periode aktif (override)`,
      periode_id: periode.periode_id,
      nama_periode: periode.nama_periode
    })
  } catch (err) {
    console.error('Set override periode error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── GET /api/periode/semua ────────────────────────────────────────────────
// Semua periode dari siklus aktif, diurutkan terbaru dulu
export const getAllPeriode = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.periode_id, p.nama_periode, p.tanggal_mulai, p.tanggal_selesai,
        p.is_override, p.siklus_id,
        CASE
          WHEN p.is_override = true THEN true
          WHEN NOT EXISTS (
            SELECT 1 FROM periode p2
            WHERE p2.siklus_id = p.siklus_id AND p2.is_override = true
          ) AND CURRENT_DATE BETWEEN p.tanggal_mulai AND p.tanggal_selesai THEN true
          ELSE false
        END AS is_aktif
      FROM periode p
      JOIN siklus_penilaian s ON p.siklus_id = s.siklus_id
      WHERE s.status_siklus = 'aktif'
        AND p.tanggal_mulai <= CURRENT_DATE
      ORDER BY p.tanggal_mulai DESC
    `)
    res.json({ periodes: result.rows })
  } catch (err) {
    console.error('Get all periode error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── GET /api/periode/aktif?siklus_id= ────────────────────────────────────
// Hybrid: override dulu, fallback ke CURRENT_DATE
// siklus_id opsional — jika tidak diisi, cari di semua siklus aktif
export const getPeriodeAktif = async (req, res) => {
  const { siklus_id } = req.query

  try {
    let result

    if (siklus_id) {
      result = await pool.query(`
        SELECT p.*
        FROM periode p
        WHERE p.siklus_id = $1
          AND (
            p.is_override = true
            OR (
              NOT EXISTS (
                SELECT 1 FROM periode
                WHERE siklus_id = $1 AND is_override = true
              )
              AND CURRENT_DATE BETWEEN p.tanggal_mulai AND p.tanggal_selesai
            )
          )
        LIMIT 1
      `, [siklus_id])
    } else {
      // Tanpa siklus_id: cari di semua siklus yang status_siklus = 'aktif'
      result = await pool.query(`
        SELECT p.*
        FROM periode p
        JOIN siklus_penilaian s ON p.siklus_id = s.siklus_id
        WHERE s.status_siklus = 'aktif'
          AND (
            p.is_override = true
            OR (
              NOT EXISTS (
                SELECT 1 FROM periode p2
                WHERE p2.siklus_id = p.siklus_id AND p2.is_override = true
              )
              AND CURRENT_DATE BETWEEN p.tanggal_mulai AND p.tanggal_selesai
            )
          )
        ORDER BY p.tanggal_mulai DESC
        LIMIT 1
      `)
    }

    if (result.rows.length === 0) {
      return res.json({ periode: null, message: 'Tidak ada periode aktif saat ini' })
    }

    res.json({ periode: result.rows[0] })
  } catch (err) {
    console.error('Get periode aktif error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}
