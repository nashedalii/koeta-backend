import pool from '../config/db.js'

// ── GET /api/ranking ──────────────────────────────────────────────────────────
// Query params:
//   mode       : 'periode' | 'siklus'  (default: 'siklus')
//   periode_id : wajib jika mode=periode
//   siklus_id  : wajib jika mode=siklus
//   armada_id  : hanya dipakai super_admin sebagai filter opsional (dropdown)
//
// Logika armada:
//   super_admin → pakai armada_id dari query param (opsional, null = semua)
//   admin       → paksa armada_id dari JWT, abaikan query param
//   petugas     → paksa armada_id dari JWT
//   driver      → paksa armada_id dari JWT
export const getRanking = async (req, res) => {
  const { mode = 'siklus', periode_id, siklus_id } = req.query
  const { role, armada_id: jwtArmadaId } = req.user

  // Tentukan filter armada berdasarkan role
  let effectiveArmadaId
  if (role === 'super_admin') {
    // Super admin boleh filter via query param, atau null = semua armada
    effectiveArmadaId = req.query.armada_id ? parseInt(req.query.armada_id) : null
  } else {
    // Admin vendor, petugas, driver → wajib pakai armada dari JWT
    effectiveArmadaId = jwtArmadaId
  }

  try {
    if (mode === 'periode') {
      if (!periode_id) {
        return res.status(400).json({ message: 'periode_id wajib diisi untuk mode periode' })
      }
      const result = await getRankingByPeriode(periode_id, effectiveArmadaId)
      return res.json(result)
    }

    if (mode === 'siklus') {
      if (!siklus_id) {
        return res.status(400).json({ message: 'siklus_id wajib diisi untuk mode siklus' })
      }
      const result = await getRankingBySiklus(siklus_id, effectiveArmadaId)
      return res.json(result)
    }

    return res.status(400).json({ message: 'mode harus periode atau siklus' })
  } catch (err) {
    console.error('Get ranking error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── GET /api/ranking/driver/:driver_id ───────────────────────────────────────
// Breakdown bulanan driver dalam satu siklus
// Query params: siklus_id (wajib)
export const getDriverDetail = async (req, res) => {
  const { driver_id } = req.params
  const { siklus_id } = req.query
  const { role, armada_id: jwtArmadaId } = req.user

  if (!siklus_id) {
    return res.status(400).json({ message: 'siklus_id wajib diisi' })
  }

  try {
    // Validasi akses: admin vendor hanya boleh lihat driver di armadanya
    if (role !== 'super_admin') {
      const driverCheck = await pool.query(
        `SELECT armada_id FROM driver WHERE driver_id = $1`,
        [driver_id]
      )
      if (driverCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Driver tidak ditemukan' })
      }
      if (driverCheck.rows[0].armada_id !== jwtArmadaId) {
        return res.status(403).json({ message: 'Akses ditolak' })
      }
    }

    // Ambil bobot untuk siklus ini
    const bobotResult = await pool.query(
      `SELECT bobot_id, nama_bobot, persentase_bobot
       FROM bobot WHERE siklus_id = $1 ORDER BY bobot_id`,
      [siklus_id]
    )

    // Ambil semua approved penilaian driver dalam siklus
    const penilaianResult = await pool.query(`
      SELECT
        p.penilaian_id,
        p.skor_total,
        p.created_at,
        pr.nama_periode,
        pr.bulan,
        pr.tahun,
        b.kode_bus,
        b.nopol,
        a.nama_armada,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'bobot_id',       bbt.bobot_id,
            'weighted_score', ROUND((pd.nilai * bbt.persentase_bobot / 100)::numeric, 2)
          ) ORDER BY bbt.bobot_id
        ) AS indicators
      FROM penilaian p
      JOIN periode    pr  ON p.periode_id   = pr.periode_id
      JOIN bus        b   ON p.bus_id       = b.bus_id
      JOIN driver     d   ON p.driver_id    = d.driver_id
      JOIN armada     a   ON d.armada_id    = a.armada_id
      JOIN penilaian_detail pd ON pd.penilaian_id = p.penilaian_id
      JOIN bobot      bbt ON pd.bobot_id    = bbt.bobot_id
      WHERE p.status_validasi = 'approved'
        AND p.driver_id       = $1
        AND pr.siklus_id      = $2
      GROUP BY
        p.penilaian_id, p.skor_total, p.created_at,
        pr.nama_periode, pr.bulan, pr.tahun, pr.tanggal_mulai,
        b.kode_bus, b.nopol, a.nama_armada
      ORDER BY pr.tanggal_mulai ASC
    `, [driver_id, siklus_id])

    // Info driver
    const driverResult = await pool.query(`
      SELECT d.nama_driver, d.nama_kernet, a.nama_armada
      FROM driver d JOIN armada a ON d.armada_id = a.armada_id
      WHERE d.driver_id = $1
    `, [driver_id])

    if (driverResult.rows.length === 0) {
      return res.status(404).json({ message: 'Driver tidak ditemukan' })
    }

    res.json({
      driver:   driverResult.rows[0],
      bobot:    bobotResult.rows,
      periodes: penilaianResult.rows
    })
  } catch (err) {
    console.error('Get driver detail error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getRankingByPeriode(periode_id, armada_id) {
  // Ambil bobot siklus yang berkaitan dengan periode ini
  const bobotResult = await pool.query(`
    SELECT bbt.bobot_id, bbt.nama_bobot, bbt.persentase_bobot
    FROM bobot bbt
    JOIN periode pr ON bbt.siklus_id = pr.siklus_id
    WHERE pr.periode_id = $1
    ORDER BY bbt.bobot_id
  `, [periode_id])

  const armadaParam = armada_id ? [periode_id, armada_id] : [periode_id]
  const armadaClause = armada_id ? 'AND d.armada_id = $2' : ''

  const result = await pool.query(`
    WITH scores AS (
      SELECT
        p.driver_id,
        d.nama_driver,
        d.nama_kernet,
        a.nama_armada,
        b.kode_bus,
        b.nopol,
        p.skor_total,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'bobot_id',       bbt.bobot_id,
            'weighted_score', ROUND((pd.nilai * bbt.persentase_bobot / 100)::numeric, 2)
          ) ORDER BY bbt.bobot_id
        ) AS indicators,
        ARRAY_AGG(
          ROUND((pd.nilai * bbt.persentase_bobot / 100)::numeric, 2)
          ORDER BY (pd.nilai * bbt.persentase_bobot / 100) DESC
        ) AS sorted_weighted
      FROM penilaian p
      JOIN driver     d   ON p.driver_id  = d.driver_id
      JOIN armada     a   ON d.armada_id  = a.armada_id
      JOIN bus        b   ON p.bus_id     = b.bus_id
      JOIN penilaian_detail pd ON pd.penilaian_id = p.penilaian_id
      JOIN bobot      bbt ON pd.bobot_id  = bbt.bobot_id
      WHERE p.status_validasi = 'approved'
        AND p.periode_id = $1
        ${armadaClause}
      GROUP BY
        p.driver_id, d.nama_driver, d.nama_kernet,
        a.nama_armada, b.kode_bus, b.nopol, p.skor_total
    )
    SELECT
      DENSE_RANK() OVER (
        ORDER BY skor_total DESC, sorted_weighted DESC
      ) AS rank,
      driver_id, nama_driver, nama_kernet,
      nama_armada, kode_bus, nopol,
      skor_total, indicators
    FROM scores
    ORDER BY rank, nama_driver
  `, armadaParam)

  return {
    mode:    'periode',
    bobot:   bobotResult.rows,
    ranking: result.rows
  }
}

async function getRankingBySiklus(siklus_id, armada_id) {
  // Ambil bobot siklus
  const bobotResult = await pool.query(
    `SELECT bobot_id, nama_bobot, persentase_bobot
     FROM bobot WHERE siklus_id = $1 ORDER BY bobot_id`,
    [siklus_id]
  )

  const armadaParam = armada_id ? [siklus_id, armada_id] : [siklus_id]
  const armadaClause = armada_id ? 'AND d.armada_id = $2' : ''

  const result = await pool.query(`
    WITH per_bobot_avg AS (
      -- Rata-rata weighted score per (driver, bobot) di semua periode siklus
      SELECT
        p.driver_id,
        pd.bobot_id,
        ROUND(AVG(pd.nilai * bbt.persentase_bobot / 100)::numeric, 2) AS avg_weighted
      FROM penilaian p
      JOIN periode          pr  ON p.periode_id   = pr.periode_id
      JOIN penilaian_detail pd  ON pd.penilaian_id = p.penilaian_id
      JOIN bobot            bbt ON pd.bobot_id     = bbt.bobot_id
      JOIN driver           d   ON p.driver_id     = d.driver_id
      WHERE p.status_validasi = 'approved'
        AND pr.siklus_id = $1
        ${armadaClause}
      GROUP BY p.driver_id, pd.bobot_id
    ),
    latest_bus AS (
      -- Bus terakhir yang dipakai driver dalam siklus ini
      SELECT DISTINCT ON (p.driver_id)
        p.driver_id,
        p.bus_id
      FROM penilaian p
      JOIN periode pr ON p.periode_id = pr.periode_id
      WHERE p.status_validasi = 'approved'
        AND pr.siklus_id = $1
      ORDER BY p.driver_id, p.created_at DESC
    ),
    scores AS (
      SELECT
        pba.driver_id,
        d.nama_driver,
        d.nama_kernet,
        a.nama_armada,
        b.kode_bus,
        b.nopol,
        ROUND(SUM(pba.avg_weighted)::numeric, 2) AS skor_total,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'bobot_id',       pba.bobot_id,
            'weighted_score', pba.avg_weighted
          ) ORDER BY pba.bobot_id
        ) AS indicators,
        ARRAY_AGG(pba.avg_weighted ORDER BY pba.avg_weighted DESC) AS sorted_weighted
      FROM per_bobot_avg pba
      JOIN driver     d   ON pba.driver_id = d.driver_id
      JOIN armada     a   ON d.armada_id   = a.armada_id
      JOIN latest_bus lb  ON lb.driver_id  = pba.driver_id
      JOIN bus        b   ON lb.bus_id     = b.bus_id
      GROUP BY
        pba.driver_id, d.nama_driver, d.nama_kernet,
        a.nama_armada, b.kode_bus, b.nopol
    )
    SELECT
      DENSE_RANK() OVER (
        ORDER BY skor_total DESC, sorted_weighted DESC
      ) AS rank,
      driver_id, nama_driver, nama_kernet,
      nama_armada, kode_bus, nopol,
      skor_total, indicators
    FROM scores
    ORDER BY rank, nama_driver
  `, armadaParam)

  return {
    mode:    'siklus',
    bobot:   bobotResult.rows,
    ranking: result.rows
  }
}
