import pool from '../config/db.js'

// ── GET /api/driver/me ────────────────────────────────────────────────────
// Profil driver yang sedang login
export const getMyProfile = async (req, res) => {
  const driver_id = req.user.user_id

  try {
    const result = await pool.query(`
      SELECT
        d.driver_id,
        d.nama_driver,
        d.nama_kernet,
        d.no_hp,
        d.status_aktif,
        a.nama_armada,
        b.kode_bus,
        b.nopol
      FROM driver d
      LEFT JOIN armada a ON d.armada_id = a.armada_id
      LEFT JOIN bus    b ON b.driver_id = d.driver_id AND b.status_aktif = 'aktif'
      WHERE d.driver_id = $1
    `, [driver_id])

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Driver tidak ditemukan' })
    }

    res.json(result.rows[0])
  } catch (err) {
    console.error('Get driver profile error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── GET /api/driver/me/penilaian?siklus_id= ───────────────────────────────
// Daftar penilaian driver yang login dalam satu siklus
export const getMyPenilaian = async (req, res) => {
  const driver_id = req.user.user_id
  const { siklus_id } = req.query

  if (!siklus_id) {
    return res.status(400).json({ message: 'siklus_id wajib diisi' })
  }

  try {
    // Ambil bobot siklus ini
    const bobotResult = await pool.query(
      `SELECT bobot_id, nama_bobot, persentase_bobot
       FROM bobot WHERE siklus_id = $1 ORDER BY bobot_id`,
      [siklus_id]
    )

    // Ambil semua penilaian approved driver dalam siklus
    const penilaianResult = await pool.query(`
      SELECT
        p.penilaian_id,
        p.skor_total,
        p.status_validasi,
        p.created_at,
        pr.periode_id,
        pr.nama_periode,
        pr.bulan,
        pr.tahun,
        pr.tanggal_mulai,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'bobot_id',        bbt.bobot_id,
            'nama_bobot',      bbt.nama_bobot,
            'persentase_bobot', bbt.persentase_bobot,
            'nilai',           pd.nilai,
            'weighted_score',  ROUND((pd.nilai * bbt.persentase_bobot / 100)::numeric, 2)
          ) ORDER BY bbt.bobot_id
        ) AS scores
      FROM penilaian p
      JOIN periode          pr  ON p.periode_id   = pr.periode_id
      JOIN penilaian_detail pd  ON pd.penilaian_id = p.penilaian_id
      JOIN bobot            bbt ON pd.bobot_id     = bbt.bobot_id
      WHERE p.driver_id       = $1
        AND pr.siklus_id      = $2
        AND p.status_validasi = 'approved'
      GROUP BY
        p.penilaian_id, p.skor_total, p.status_validasi, p.created_at,
        pr.periode_id, pr.nama_periode, pr.bulan, pr.tahun, pr.tanggal_mulai
      ORDER BY pr.tanggal_mulai ASC
    `, [driver_id, siklus_id])

    res.json({
      bobot:    bobotResult.rows,
      periodes: penilaianResult.rows
    })
  } catch (err) {
    console.error('Get driver penilaian error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── GET /api/driver/me/ranking?siklus_id= ─────────────────────────────────
// Posisi ranking driver yang login dalam satu siklus
export const getMyRanking = async (req, res) => {
  const driver_id = req.user.user_id
  const { siklus_id } = req.query

  if (!siklus_id) {
    return res.status(400).json({ message: 'siklus_id wajib diisi' })
  }

  try {
    // Hitung skor rata-rata semua driver dalam siklus (approved)
    const rankingResult = await pool.query(`
      WITH per_driver AS (
        SELECT
          p.driver_id,
          ROUND(AVG(p.skor_total)::numeric, 2) AS skor_rata
        FROM penilaian p
        JOIN periode pr ON p.periode_id = pr.periode_id
        WHERE p.status_validasi = 'approved'
          AND pr.siklus_id = $1
        GROUP BY p.driver_id
      ),
      ranked AS (
        SELECT
          driver_id,
          skor_rata,
          DENSE_RANK() OVER (ORDER BY skor_rata DESC) AS rank
        FROM per_driver
      )
      SELECT
        r.rank,
        r.skor_rata            AS skor_total,
        (SELECT COUNT(*) FROM per_driver) AS total_driver
      FROM ranked r
      WHERE r.driver_id = $2
    `, [siklus_id, driver_id])

    // Juga ambil skor periode terakhir
    const lastPeriodeResult = await pool.query(`
      SELECT
        p.skor_total,
        pr.nama_periode,
        pr.bulan,
        pr.tahun,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'bobot_id',        bbt.bobot_id,
            'nama_bobot',      bbt.nama_bobot,
            'persentase_bobot', bbt.persentase_bobot,
            'nilai',           pd.nilai,
            'weighted_score',  ROUND((pd.nilai * bbt.persentase_bobot / 100)::numeric, 2)
          ) ORDER BY bbt.bobot_id
        ) AS scores
      FROM penilaian p
      JOIN periode          pr  ON p.periode_id   = pr.periode_id
      JOIN penilaian_detail pd  ON pd.penilaian_id = p.penilaian_id
      JOIN bobot            bbt ON pd.bobot_id     = bbt.bobot_id
      WHERE p.driver_id       = $1
        AND pr.siklus_id      = $2
        AND p.status_validasi = 'approved'
      GROUP BY
        p.penilaian_id, p.skor_total,
        pr.nama_periode, pr.bulan, pr.tahun, pr.tanggal_mulai
      ORDER BY pr.tanggal_mulai DESC
      LIMIT 1
    `, [driver_id, siklus_id])

    res.json({
      rank:          rankingResult.rows[0]?.rank        ?? null,
      skor_total:    rankingResult.rows[0]?.skor_total   ?? null,
      total_driver:  rankingResult.rows[0]?.total_driver ?? 0,
      periode_terakhir: lastPeriodeResult.rows[0] ?? null
    })
  } catch (err) {
    console.error('Get driver ranking error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}
