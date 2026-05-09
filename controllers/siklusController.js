import pool from '../config/db.js'

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
]

// ── Helper: format angka jadi 2 digit ────────────────────────────────────
const pad = n => String(n).padStart(2, '0')

// ── Helper: generate daftar periode bulanan ──────────────────────────────
// Menggunakan string YYYY-MM-DD langsung untuk menghindari timezone offset
function generatePeriodes(siklusId, tanggalMulai, tanggalSelesai) {
  // Parse komponen tanggal dari string (hindari new Date(string) yang bisa shift timezone)
  const [startYear, startMonth] = tanggalMulai.split('-').map(Number)
  const [endYear,   endMonth]   = tanggalSelesai.split('-').map(Number)

  const periodes = []
  let year  = startYear
  let month = startMonth // 1-indexed (Januari = 1)
  let isFirstPeriod = true

  while (year < endYear || (year === endYear && month <= endMonth)) {
    // Bulan pertama: pakai tanggal mulai siklus yang sebenarnya
    // Bulan berikutnya: selalu tanggal 1
    const firstDay = isFirstPeriod ? tanggalMulai : `${year}-${pad(month)}-01`

    // tanggal_selesai selalu hari terakhir bulan (Opsi A)
    const d = new Date(year, month, 0)
    const lastDay = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

    periodes.push({
      bulan:           BULAN[month - 1], // BULAN array 0-indexed
      tahun:           year,
      nama_periode:    `${BULAN[month - 1]} ${year}`,
      tanggal_mulai:   firstDay,
      tanggal_selesai: lastDay,
      siklus_id:       siklusId,
    })

    isFirstPeriod = false
    // Pindah ke bulan berikutnya
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }

  return periodes
}

// ── GET /api/siklus ──────────────────────────────────────────────────────
export const getAllSiklus = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*,
        CASE
          WHEN s.status_siklus = 'nonaktif'        THEN 'nonaktif'
          WHEN s.tanggal_mulai > CURRENT_DATE       THEN 'belum_dimulai'
          WHEN s.tanggal_selesai < CURRENT_DATE     THEN 'selesai'
          ELSE 'berjalan'
        END AS status_display,
        COUNT(p.periode_id)::int AS jumlah_periode
      FROM siklus_penilaian s
      LEFT JOIN periode p ON p.siklus_id = s.siklus_id
      GROUP BY s.siklus_id
      ORDER BY s.tanggal_mulai DESC
    `)
    res.json(result.rows)
  } catch (err) {
    console.error('Get all siklus error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── GET /api/siklus/:id ───────────────────────────────────────────────────
export const getSiklusById = async (req, res) => {
  const { id } = req.params
  try {
    const siklusResult = await pool.query(
      'SELECT * FROM siklus_penilaian WHERE siklus_id = $1', [id]
    )
    if (siklusResult.rows.length === 0) {
      return res.status(404).json({ message: 'Siklus tidak ditemukan' })
    }

    const periodeResult = await pool.query(`
      SELECT p.*,
        CASE
          WHEN p.is_override = true THEN true
          WHEN NOT EXISTS (
            SELECT 1 FROM periode WHERE siklus_id = p.siklus_id AND is_override = true
          ) AND CURRENT_DATE BETWEEN p.tanggal_mulai AND p.tanggal_selesai THEN true
          ELSE false
        END AS is_aktif
      FROM periode p
      WHERE p.siklus_id = $1
      ORDER BY p.tanggal_mulai
    `, [id])

    res.json({
      siklus: siklusResult.rows[0],
      periodes: periodeResult.rows
    })
  } catch (err) {
    console.error('Get siklus by id error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── DELETE /api/siklus/:id ───────────────────────────────────────────────
export const deleteSiklus = async (req, res) => {
  const { id } = req.params

  const client = await pool.connect()
  try {
    const siklusResult = await client.query(
      'SELECT * FROM siklus_penilaian WHERE siklus_id = $1', [id]
    )
    if (siklusResult.rows.length === 0) {
      return res.status(404).json({ message: 'Siklus tidak ditemukan' })
    }
    const siklus = siklusResult.rows[0]

    // Hanya bisa hapus jika belum mulai
    const today = new Date().toISOString().split('T')[0]
    if (siklus.tanggal_mulai <= today) {
      return res.status(400).json({ message: 'Siklus yang sudah berjalan atau selesai tidak dapat dihapus' })
    }

    await client.query('BEGIN')
    await client.query('DELETE FROM bobot   WHERE siklus_id = $1', [id])
    await client.query('DELETE FROM periode WHERE siklus_id = $1', [id])
    await client.query('DELETE FROM siklus_penilaian WHERE siklus_id = $1', [id])
    await client.query('COMMIT')

    res.json({ message: `Siklus "${siklus.nama_siklus}" berhasil dihapus` })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Delete siklus error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  } finally {
    client.release()
  }
}

// ── POST /api/siklus ─────────────────────────────────────────────────────
export const createSiklus = async (req, res) => {
  const { nama_siklus, tanggal_mulai, tanggal_selesai } = req.body

  if (!nama_siklus || !tanggal_mulai || !tanggal_selesai) {
    return res.status(400).json({ message: 'nama_siklus, tanggal_mulai, dan tanggal_selesai wajib diisi' })
  }

  if (new Date(tanggal_selesai) <= new Date(tanggal_mulai)) {
    return res.status(400).json({ message: 'tanggal_selesai harus setelah tanggal_mulai' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Sesuaikan tanggal_selesai ke hari terakhir bulannya
    const [endY, endM] = tanggal_selesai.split('-').map(Number)
    const lastDayOfEndMonth = new Date(endY, endM, 0)
    const tanggal_selesai_adjusted = `${lastDayOfEndMonth.getFullYear()}-${pad(lastDayOfEndMonth.getMonth() + 1)}-${pad(lastDayOfEndMonth.getDate())}`

    // 1. Insert siklus
    const siklusResult = await client.query(
      `INSERT INTO siklus_penilaian (nama_siklus, tanggal_mulai, tanggal_selesai)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [nama_siklus, tanggal_mulai, tanggal_selesai_adjusted]
    )
    const siklus = siklusResult.rows[0]

    // 2. Generate periode bulanan
    const periodes = generatePeriodes(siklus.siklus_id, tanggal_mulai, tanggal_selesai_adjusted)

    // 3. Cek overlap: ada bulan/tahun yang sudah dimiliki siklus lain?
    for (const p of periodes) {
      const overlap = await client.query(
        `SELECT nama_periode FROM periode WHERE bulan = $1 AND tahun = $2`,
        [p.bulan, p.tahun]
      )
      if (overlap.rows.length > 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({
          message: `Periode ${p.nama_periode} sudah ada pada siklus yang sedang berjalan. Pastikan tanggal mulai siklus baru tidak tumpang tindih dengan siklus sebelumnya.`
        })
      }
    }

    // 4. Insert periode
    for (const p of periodes) {
      await client.query(
        `INSERT INTO periode (bulan, tahun, nama_periode, tanggal_mulai, tanggal_selesai, siklus_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [p.bulan, p.tahun, p.nama_periode, p.tanggal_mulai, p.tanggal_selesai, p.siklus_id]
      )
    }

    await client.query('COMMIT')

    res.status(201).json({
      message: `Siklus berhasil dibuat dengan ${periodes.length} periode bulanan`,
      siklus,
      jumlah_periode: periodes.length
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Create siklus error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  } finally {
    client.release()
  }
}
