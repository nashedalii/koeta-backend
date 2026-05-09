import pool from '../config/db.js'

// ── GET /api/validasi ─────────────────────────────────────────────────────────
// List semua penilaian dengan filter opsional: status, armada_id, periode_id, driver_id
export const getAllValidasi = async (req, res) => {
  const { role, armada_id: callerArmadaId } = req.user
  const { status_validasi, armada_id, periode_id, driver_id } = req.query

  try {
    const conditions = ['1=1']
    const params = []

    // Admin vendor dipaksa filter ke armadanya sendiri
    const effectiveArmadaId = role === 'super_admin'
      ? (armada_id || null)
      : callerArmadaId

    if (status_validasi) {
      params.push(status_validasi)
      conditions.push(`p.status_validasi = $${params.length}`)
    }
    if (effectiveArmadaId) {
      params.push(effectiveArmadaId)
      conditions.push(`d.armada_id = $${params.length}`)
    }
    if (periode_id) {
      params.push(periode_id)
      conditions.push(`p.periode_id = $${params.length}`)
    }
    if (driver_id) {
      params.push(driver_id)
      conditions.push(`p.driver_id = $${params.length}`)
    }

    const result = await pool.query(`
      SELECT
        p.penilaian_id,
        p.status_validasi,
        p.skor_total,
        p.catatan_petugas,
        p.note_validasi,
        p.created_at,
        p.updated_at,
        d.nama_driver,
        b.kode_bus,
        b.nopol,
        a.nama_armada,
        pr.nama_periode,
        pr.bulan,
        pr.tahun,
        pt.nama_petugas AS nama_petugas_input,
        adm.nama_admin AS nama_admin_validasi
      FROM penilaian p
      JOIN driver d       ON p.driver_id    = d.driver_id
      JOIN bus b          ON p.bus_id       = b.bus_id
      JOIN armada a       ON d.armada_id    = a.armada_id
      JOIN periode pr     ON p.periode_id   = pr.periode_id
      JOIN petugas pt     ON p.petugas_id   = pt.petugas_id
      LEFT JOIN admin adm ON p.validated_by = adm.admin_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.created_at DESC
    `, params)

    res.json({ penilaian: result.rows })
  } catch (err) {
    console.error('Get all validasi error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── GET /api/validasi/:id ─────────────────────────────────────────────────────
export const getValidasiById = async (req, res) => {
  const { id } = req.params
  const { role, armada_id: callerArmadaId } = req.user

  try {
    const penilaianResult = await pool.query(`
      SELECT
        p.penilaian_id,
        p.status_validasi,
        p.skor_total,
        p.catatan_petugas,
        p.note_validasi,
        p.created_at,
        p.updated_at,
        d.nama_driver,
        d.nama_kernet,
        d.armada_id AS driver_armada_id,
        b.kode_bus,
        b.nopol,
        a.nama_armada,
        pr.nama_periode,
        pr.bulan,
        pr.tahun,
        pt.nama_petugas AS nama_petugas_input,
        adm.nama_admin  AS nama_admin_validasi,
        p.validated_by
      FROM penilaian p
      JOIN driver d       ON p.driver_id    = d.driver_id
      JOIN bus b          ON p.bus_id       = b.bus_id
      JOIN armada a       ON d.armada_id    = a.armada_id
      JOIN periode pr     ON p.periode_id   = pr.periode_id
      JOIN petugas pt     ON p.petugas_id   = pt.petugas_id
      LEFT JOIN admin adm ON p.validated_by = adm.admin_id
      WHERE p.penilaian_id = $1
    `, [id])

    if (penilaianResult.rows.length === 0) {
      return res.status(404).json({ message: 'Penilaian tidak ditemukan' })
    }

    const penilaian = penilaianResult.rows[0]

    // Admin vendor tidak boleh akses penilaian di luar armadanya
    if (role !== 'super_admin' && penilaian.driver_armada_id !== callerArmadaId) {
      return res.status(403).json({ message: 'Akses ditolak' })
    }

    const detailResult = await pool.query(`
      SELECT
        pd.penilaian_detail_id,
        pd.nilai,
        bbt.bobot_id,
        bbt.nama_bobot,
        bbt.persentase_bobot
      FROM penilaian_detail pd
      JOIN bobot bbt ON pd.bobot_id = bbt.bobot_id
      WHERE pd.penilaian_id = $1
      ORDER BY bbt.bobot_id
    `, [id])

    const fotoResult = await pool.query(`
      SELECT bukti_id, file_path, nama_file, uploaded_at
      FROM bukti_foto
      WHERE penilaian_id = $1
      ORDER BY uploaded_at
    `, [id])

    const logResult = await pool.query(`
      SELECT
        vl.validasi_log_id,
        vl.aksi,
        vl.alasan,
        vl.created_at,
        adm.nama_admin
      FROM validasi_log vl
      JOIN admin adm ON vl.admin_id = adm.admin_id
      WHERE vl.penilaian_id = $1
      ORDER BY vl.created_at DESC
    `, [id])

    res.json({
      penilaian,
      details: detailResult.rows,
      foto:    fotoResult.rows,
      log:     logResult.rows
    })
  } catch (err) {
    console.error('Get validasi by id error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── PUT /api/validasi/:id/approve ─────────────────────────────────────────────
export const approvePenilaian = async (req, res) => {
  const admin_id = req.user.user_id
  const { role, armada_id: callerArmadaId } = req.user
  const { id } = req.params

  const client = await pool.connect()
  try {
    const check = await client.query(
      `SELECT p.status_validasi, d.armada_id AS driver_armada_id
       FROM penilaian p JOIN driver d ON p.driver_id = d.driver_id
       WHERE p.penilaian_id = $1`,
      [id]
    )
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Penilaian tidak ditemukan' })
    }

    if (role !== 'super_admin' && check.rows[0].driver_armada_id !== callerArmadaId) {
      return res.status(403).json({ message: 'Akses ditolak' })
    }

    if (check.rows[0].status_validasi === 'approved') {
      return res.status(409).json({ message: 'Penilaian sudah disetujui sebelumnya' })
    }

    await client.query('BEGIN')

    await client.query(`
      UPDATE penilaian
      SET status_validasi = 'approved',
          validated_by    = $1,
          note_validasi   = NULL,
          updated_at      = NOW()
      WHERE penilaian_id  = $2
    `, [admin_id, id])

    await client.query(`
      INSERT INTO validasi_log (penilaian_id, admin_id, aksi)
      VALUES ($1, $2, 'approved')
    `, [id, admin_id])

    await client.query('COMMIT')

    res.json({ message: 'Penilaian berhasil disetujui' })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Approve penilaian error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  } finally {
    client.release()
  }
}

// ── PUT /api/validasi/:id/reject ──────────────────────────────────────────────
export const rejectPenilaian = async (req, res) => {
  const admin_id = req.user.user_id
  const { role, armada_id: callerArmadaId } = req.user
  const { id } = req.params
  const { alasan } = req.body || {}

  if (!alasan || alasan.trim() === '') {
    return res.status(400).json({ message: 'Alasan penolakan wajib diisi' })
  }

  const client = await pool.connect()
  try {
    const check = await client.query(
      `SELECT p.status_validasi, d.armada_id AS driver_armada_id
       FROM penilaian p JOIN driver d ON p.driver_id = d.driver_id
       WHERE p.penilaian_id = $1`,
      [id]
    )
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Penilaian tidak ditemukan' })
    }

    if (role !== 'super_admin' && check.rows[0].driver_armada_id !== callerArmadaId) {
      return res.status(403).json({ message: 'Akses ditolak' })
    }

    await client.query('BEGIN')

    await client.query(`
      UPDATE penilaian
      SET status_validasi = 'rejected',
          validated_by    = $1,
          note_validasi   = $2,
          updated_at      = NOW()
      WHERE penilaian_id  = $3
    `, [admin_id, alasan.trim(), id])

    await client.query(`
      INSERT INTO validasi_log (penilaian_id, admin_id, aksi, alasan)
      VALUES ($1, $2, 'rejected', $3)
    `, [id, admin_id, alasan.trim()])

    await client.query('COMMIT')

    res.json({ message: 'Penilaian berhasil ditolak' })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Reject penilaian error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  } finally {
    client.release()
  }
}
