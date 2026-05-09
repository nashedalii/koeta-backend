import pool from '../config/db.js'

const QUERY_PERIODE_AKTIF = `
  SELECT p.periode_id, p.nama_periode, p.bulan, p.tahun, p.tanggal_mulai, p.tanggal_selesai
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
`

// ── GET /api/dashboard/admin ──────────────────────────────────────────────
export const getAdminDashboard = async (req, res) => {
  const { role, armada_id } = req.user
  const isSuperAdmin = role === 'super_admin'

  // Clause & param helpers
  const armadaDriverClause = isSuperAdmin ? '' : 'AND d.armada_id = $1'
  const armadaDriverParam  = isSuperAdmin ? [] : [armada_id]

  try {
    // Fetch periode aktif terlebih dahulu agar bisa dipakai sebagai filter
    const periodeAktifResult = await pool.query(QUERY_PERIODE_AKTIF)
    const periodeAktif = periodeAktifResult.rows[0] || null
    const periodeId = periodeAktif?.periode_id || null

    // approved periode ini: filter by periode_id aktif (bukan bulan kalender)
    const approvedParams = isSuperAdmin
      ? (periodeId ? [periodeId] : [])
      : (periodeId ? [armada_id, periodeId] : [armada_id])
    const approvedPeriodeClause = periodeId
      ? `AND p.periode_id = $${isSuperAdmin ? 1 : 2}`
      : 'AND 1=0'

    const [
      driverResult,
      petugasResult,
      pendingResult,
      approvedPeriodeIniResult,
    ] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total FROM driver d WHERE d.status_aktif = 'aktif' ${armadaDriverClause}`,
        armadaDriverParam
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM petugas pt WHERE pt.status_aktif = 'aktif' ${isSuperAdmin ? '' : 'AND pt.armada_id = $1'}`,
        armadaDriverParam
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM penilaian p
         ${isSuperAdmin ? '' : 'JOIN driver d ON p.driver_id = d.driver_id'}
         WHERE p.status_validasi = 'pending'
         ${isSuperAdmin ? '' : 'AND d.armada_id = $1'}`,
        armadaDriverParam
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM penilaian p
         ${isSuperAdmin ? '' : 'JOIN driver d ON p.driver_id = d.driver_id'}
         WHERE p.status_validasi = 'approved'
           ${approvedPeriodeClause}
         ${isSuperAdmin ? '' : `AND d.armada_id = $1`}`,
        approvedParams
      ),
    ])

    // Total armada hanya relevan untuk super_admin
    let totalArmada = null
    if (isSuperAdmin) {
      const armadaResult = await pool.query(`SELECT COUNT(*) AS total FROM armada`)
      totalArmada = parseInt(armadaResult.rows[0].total)
    }

    // Cek warning: apakah periode aktif adalah periode terakhir dan belum ada siklus berikutnya
    let warningPeriode = null
    if (periodeAktif) {
      const hariTersisaResult = await pool.query(
        `SELECT (p.tanggal_selesai - CURRENT_DATE) AS hari_tersisa,
                NOT EXISTS (
                  SELECT 1 FROM periode p2
                  WHERE p2.siklus_id = p.siklus_id
                    AND p2.tanggal_mulai > p.tanggal_mulai
                ) AS is_periode_terakhir_siklus,
                NOT EXISTS (
                  SELECT 1 FROM siklus_penilaian s2
                  WHERE s2.tanggal_mulai > p.tanggal_selesai
                ) AS belum_ada_siklus_berikutnya
         FROM periode p WHERE p.periode_id = $1`,
        [periodeAktif.periode_id]
      )
      const w = hariTersisaResult.rows[0]
      if (w && w.is_periode_terakhir_siklus && w.belum_ada_siklus_berikutnya) {
        warningPeriode = {
          aktif: true,
          hari_tersisa: parseInt(w.hari_tersisa),
        }
      }
    }

    // Top 5 ranking — dari periode aktif, difilter by armada jika admin vendor
    const top5Params = isSuperAdmin
      ? (periodeAktif ? [periodeAktif.periode_id] : [])
      : (periodeAktif ? [periodeAktif.periode_id, armada_id] : [armada_id])

    const armadaJoinClause = isSuperAdmin ? '' : `AND d.armada_id = $${periodeAktif ? 2 : 1}`

    let top5 = []
    if (periodeAktif) {
      const top5Result = await pool.query(`
        SELECT
          DENSE_RANK() OVER (ORDER BY p.skor_total DESC) AS rank,
          d.nama_driver,
          d.foto_profil,
          a.nama_armada,
          b.kode_bus,
          p.skor_total
        FROM penilaian p
        JOIN driver d ON p.driver_id = d.driver_id
        JOIN armada a ON d.armada_id = a.armada_id
        JOIN bus    b ON p.bus_id    = b.bus_id
        WHERE p.status_validasi = 'approved'
          AND p.periode_id = $1
          ${isSuperAdmin ? '' : 'AND d.armada_id = $2'}
        ORDER BY rank, d.nama_driver
        LIMIT 5
      `, isSuperAdmin ? [periodeAktif.periode_id] : [periodeAktif.periode_id, armada_id])
      top5 = top5Result.rows
    } else {
      // Fallback: periode terakhir yang ada penilaian approved
      const lastPeriodeResult = await pool.query(`
        SELECT pr.periode_id, pr.nama_periode, pr.bulan, pr.tahun
        FROM penilaian p
        JOIN periode pr ON p.periode_id = pr.periode_id
        JOIN driver  d  ON p.driver_id  = d.driver_id
        WHERE p.status_validasi = 'approved'
          ${isSuperAdmin ? '' : 'AND d.armada_id = $1'}
        ORDER BY pr.tanggal_mulai DESC
        LIMIT 1
      `, armadaDriverParam)

      if (lastPeriodeResult.rows.length > 0) {
        const lastPeriode = lastPeriodeResult.rows[0]
        const top5Result = await pool.query(`
          SELECT
            DENSE_RANK() OVER (ORDER BY p.skor_total DESC) AS rank,
            d.nama_driver,
            d.foto_profil,
            a.nama_armada,
            b.kode_bus,
            p.skor_total,
            $2 AS nama_periode
          FROM penilaian p
          JOIN driver d ON p.driver_id = d.driver_id
          JOIN armada a ON d.armada_id = a.armada_id
          JOIN bus    b ON p.bus_id    = b.bus_id
          WHERE p.status_validasi = 'approved'
            AND p.periode_id = $1
            ${isSuperAdmin ? '' : 'AND d.armada_id = $3'}
          ORDER BY rank, d.nama_driver
          LIMIT 5
        `, isSuperAdmin
          ? [lastPeriode.periode_id, lastPeriode.nama_periode]
          : [lastPeriode.periode_id, lastPeriode.nama_periode, armada_id]
        )
        top5 = top5Result.rows
      }
    }

    // Alert login: siklus mulai besok tapi belum ada bobot
    const alertH1Result = await pool.query(`
      SELECT s.siklus_id, s.nama_siklus, s.tanggal_mulai
      FROM siklus_penilaian s
      WHERE s.tanggal_mulai = CURRENT_DATE + INTERVAL '1 day'
        AND NOT EXISTS (
          SELECT 1 FROM bobot b WHERE b.siklus_id = s.siklus_id
        )
      LIMIT 1
    `)
    const alertBobotH1 = alertH1Result.rows[0] || null

    // Cek warning: ada siklus yang belum punya bobot (aktif atau mendatang)
    const sikusTanpaBobotResult = await pool.query(`
      SELECT s.siklus_id, s.nama_siklus, s.tanggal_mulai,
        s.tanggal_mulai > CURRENT_DATE AS is_future
      FROM siklus_penilaian s
      WHERE s.tanggal_selesai >= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM bobot b WHERE b.siklus_id = s.siklus_id
        )
      ORDER BY s.tanggal_mulai ASC
      LIMIT 1
    `)
    const warningBobot = sikusTanpaBobotResult.rows[0] || null

    res.json({
      total_driver_aktif:       parseInt(driverResult.rows[0].total),
      total_armada:             totalArmada,
      total_petugas_aktif:      parseInt(petugasResult.rows[0].total),
      total_pending_validasi:   parseInt(pendingResult.rows[0].total),
      total_approved_bulan_ini: parseInt(approvedPeriodeIniResult.rows[0].total),
      periode_aktif:            periodeAktif,
      top5_ranking:             top5,
      warning_periode:          warningPeriode,
      alert_bobot_h1:           alertBobotH1
        ? { siklus_id: alertBobotH1.siklus_id, nama_siklus: alertBobotH1.nama_siklus, tanggal_mulai: alertBobotH1.tanggal_mulai }
        : null,
      warning_bobot:            warningBobot
        ? { siklus_id: warningBobot.siklus_id, nama_siklus: warningBobot.nama_siklus, is_future: warningBobot.is_future }
        : null,
    })
  } catch (err) {
    console.error('Admin dashboard error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── GET /api/dashboard/top5?armada_id=X ──────────────────────────────────
export const getTop5 = async (req, res) => {
  const { role, armada_id: userArmadaId } = req.user
  const isSuperAdmin = role === 'super_admin'

  // super_admin boleh filter by armada via query param; admin vendor selalu pakai armada sendiri
  const filterArmadaId = isSuperAdmin
    ? (req.query.armada_id ? parseInt(req.query.armada_id) : null)
    : userArmadaId

  const armadaClause  = filterArmadaId ? `AND d.armada_id = $2` : ''

  try {
    // Cari periode aktif (hybrid: override → CURRENT_DATE)
    const periodeResult = await pool.query(QUERY_PERIODE_AKTIF)
    let periodeAktif = periodeResult.rows[0] || null

    // Fallback ke periode terakhir yang ada data approved
    if (!periodeAktif) {
      const lastPeriode = await pool.query(`
        SELECT pr.periode_id, pr.nama_periode
        FROM penilaian p
        JOIN periode pr ON p.periode_id = pr.periode_id
        JOIN driver  d  ON p.driver_id  = d.driver_id
        WHERE p.status_validasi = 'approved'
          ${filterArmadaId ? 'AND d.armada_id = $1' : ''}
        ORDER BY pr.tanggal_mulai DESC
        LIMIT 1
      `, filterArmadaId ? [filterArmadaId] : [])
      periodeAktif = lastPeriode.rows[0] || null
    }

    if (!periodeAktif) return res.json({ top5: [], nama_periode: null })

    const params = filterArmadaId
      ? [periodeAktif.periode_id, filterArmadaId]
      : [periodeAktif.periode_id]

    const result = await pool.query(`
      SELECT
        DENSE_RANK() OVER (ORDER BY p.skor_total DESC) AS rank,
        d.nama_driver,
        d.foto_profil,
        a.nama_armada,
        b.kode_bus,
        p.skor_total
      FROM penilaian p
      JOIN driver d ON p.driver_id = d.driver_id
      JOIN armada a ON d.armada_id = a.armada_id
      JOIN bus    b ON p.bus_id    = b.bus_id
      WHERE p.status_validasi = 'approved'
        AND p.periode_id = $1
        ${armadaClause}
      ORDER BY rank, d.nama_driver
      LIMIT 5
    `, params)

    res.json({ top5: result.rows, nama_periode: periodeAktif.nama_periode })
  } catch (err) {
    console.error('top5 error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── GET /api/dashboard/petugas ────────────────────────────────────────────
export const getPetugasDashboard = async (req, res) => {
  const petugas_id = req.user.user_id

  try {
    const petugasResult = await pool.query(`
      SELECT pt.nama_petugas, pt.nomor_pegawai, a.armada_id, a.nama_armada
      FROM petugas pt
      LEFT JOIN armada a ON pt.armada_id = a.armada_id
      WHERE pt.petugas_id = $1
    `, [petugas_id])

    if (petugasResult.rows.length === 0) {
      return res.status(404).json({ message: 'Petugas tidak ditemukan' })
    }

    const petugas = petugasResult.rows[0]
    const armada_id = petugas.armada_id

    const periodeAktifResult = await pool.query(QUERY_PERIODE_AKTIF)
    const periodeAktif = periodeAktifResult.rows[0] || null

    const totalDriverResult = await pool.query(`
      SELECT COUNT(*) AS total FROM driver
      WHERE armada_id = $1 AND status_aktif = 'aktif'
    `, [armada_id])

    const statusPenilaianResult = periodeAktif
      ? await pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE TRUE)                              AS total,
            COUNT(*) FILTER (WHERE status_validasi = 'pending')       AS pending,
            COUNT(*) FILTER (WHERE status_validasi = 'approved')      AS approved,
            COUNT(*) FILTER (WHERE status_validasi = 'rejected')      AS rejected
          FROM penilaian
          WHERE created_by = $1
            AND periode_id = $2
        `, [petugas_id, periodeAktif.periode_id])
      : { rows: [{ total: 0, pending: 0, approved: 0, rejected: 0 }] }

    let rataSkorArmada = null
    if (periodeAktif) {
      const rataResult = await pool.query(`
        SELECT ROUND(AVG(p.skor_total)::numeric, 2) AS rata_rata
        FROM penilaian p
        JOIN driver d ON p.driver_id = d.driver_id
        WHERE d.armada_id = $1
          AND p.status_validasi = 'approved'
          AND p.periode_id = $2
      `, [armada_id, periodeAktif.periode_id])
      rataSkorArmada = rataResult.rows[0]?.rata_rata ?? null
    }

    const belumDinilaiResult = periodeAktif
      ? await pool.query(`
          SELECT d.driver_id, d.nama_driver, d.nama_kernet, b.kode_bus, b.nopol
          FROM driver d
          LEFT JOIN bus b ON b.driver_id = d.driver_id AND b.status_aktif = 'aktif'
          WHERE d.armada_id = $1
            AND d.status_aktif = 'aktif'
            AND d.driver_id NOT IN (
              SELECT p.driver_id FROM penilaian p
              WHERE p.created_by = $2
                AND p.periode_id = $3
            )
          ORDER BY d.nama_driver
        `, [armada_id, petugas_id, periodeAktif.periode_id])
      : await pool.query(`
          SELECT d.driver_id, d.nama_driver, d.nama_kernet, b.kode_bus, b.nopol
          FROM driver d
          LEFT JOIN bus b ON b.driver_id = d.driver_id AND b.status_aktif = 'aktif'
          WHERE d.armada_id = $1
            AND d.status_aktif = 'aktif'
          ORDER BY d.nama_driver
        `, [armada_id])

    const statusPenilaian = statusPenilaianResult.rows[0]

    res.json({
      nama_petugas:        petugas.nama_petugas,
      nama_armada:         petugas.nama_armada,
      total_driver_aktif:  parseInt(totalDriverResult.rows[0].total),
      periode_aktif:       periodeAktif,
      penilaian_bulan_ini: {
        total:    parseInt(statusPenilaian.total),
        pending:  parseInt(statusPenilaian.pending),
        approved: parseInt(statusPenilaian.approved),
        rejected: parseInt(statusPenilaian.rejected),
      },
      rata_skor_armada:      rataSkorArmada ? parseFloat(rataSkorArmada) : null,
      driver_belum_dinilai:  belumDinilaiResult.rows,
    })
  } catch (err) {
    console.error('Petugas dashboard error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}
