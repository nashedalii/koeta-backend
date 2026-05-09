import pool from '../config/db.js'
import supabase from '../config/supabase.js'

// ── POST /api/penilaian ───────────────────────────────────────────────────────
export const createPenilaian = async (req, res) => {
  const petugas_id = req.user.user_id
  const { driver_id, periode_id, catatan_petugas, details } = req.body

  // Validasi input dasar
  if (!driver_id || !periode_id) {
    return res.status(400).json({ message: 'driver_id dan periode_id wajib diisi' })
  }
  if (!Array.isArray(details) || details.length === 0) {
    return res.status(400).json({ message: 'Detail penilaian tidak boleh kosong' })
  }
  for (const d of details) {
    if (!d.bobot_id || d.nilai === undefined || d.nilai === null) {
      return res.status(400).json({ message: 'Setiap detail harus memiliki bobot_id dan nilai' })
    }
    if (d.nilai < 0 || d.nilai > 100) {
      return res.status(400).json({ message: `Nilai harus antara 0 dan 100` })
    }
  }

  const client = await pool.connect()
  try {
    // Cek periode ada
    const periodeCheck = await client.query(
      'SELECT p.periode_id, p.siklus_id FROM periode p WHERE p.periode_id = $1',
      [periode_id]
    )
    if (periodeCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Periode tidak ditemukan' })
    }
    const { siklus_id } = periodeCheck.rows[0]

    // Cek driver berada di armada yang sama dengan petugas
    const armadaCheck = await client.query(
      `SELECT d.driver_id FROM driver d
       JOIN petugas pt ON pt.armada_id = d.armada_id
       WHERE d.driver_id = $1 AND pt.petugas_id = $2`,
      [driver_id, petugas_id]
    )
    if (armadaCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Driver tidak berada di armada Anda' })
    }

    // Auto-resolve bus_id dari bus yang sedang diassign ke driver
    const busResult = await client.query(
      `SELECT bus_id FROM bus WHERE driver_id = $1 AND status_aktif = 'aktif' LIMIT 1`,
      [driver_id]
    )
    if (busResult.rows.length === 0) {
      return res.status(400).json({ message: 'Driver tidak memiliki bus aktif yang diassign. Hubungi admin.' })
    }
    const bus_id = busResult.rows[0].bus_id

    // Cek driver belum punya penilaian di periode ini
    const dupCheck = await client.query(
      'SELECT 1 FROM penilaian WHERE driver_id = $1 AND periode_id = $2',
      [driver_id, periode_id]
    )
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ message: 'Driver sudah memiliki penilaian untuk periode ini' })
    }

    // Ambil semua bobot siklus untuk validasi & hitung skor
    const bobotResult = await client.query(
      'SELECT bobot_id, persentase_bobot FROM bobot WHERE siklus_id = $1',
      [siklus_id]
    )
    if (bobotResult.rows.length === 0) {
      return res.status(400).json({ message: 'Bobot siklus belum dikonfigurasi' })
    }

    const bobotMap = {}
    for (const b of bobotResult.rows) {
      bobotMap[b.bobot_id] = parseFloat(b.persentase_bobot)
    }

    // Validasi semua bobot_id valid dan ada di siklus ini
    for (const d of details) {
      if (bobotMap[d.bobot_id] === undefined) {
        return res.status(400).json({ message: `bobot_id ${d.bobot_id} tidak valid untuk siklus ini` })
      }
    }

    // Hitung skor_total
    let skor_total = 0
    for (const d of details) {
      skor_total += (parseFloat(d.nilai) * bobotMap[d.bobot_id]) / 100
    }
    skor_total = Math.round(skor_total * 100) / 100

    await client.query('BEGIN')

    // Insert penilaian
    const penilaianResult = await client.query(
      `INSERT INTO penilaian
         (periode_id, driver_id, bus_id, petugas_id, skor_total, catatan_petugas, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING penilaian_id`,
      [periode_id, driver_id, bus_id, petugas_id, skor_total, catatan_petugas || null, petugas_id]
    )
    const penilaian_id = penilaianResult.rows[0].penilaian_id

    // Insert semua penilaian_detail
    for (const d of details) {
      await client.query(
        `INSERT INTO penilaian_detail (penilaian_id, bobot_id, nilai)
         VALUES ($1, $2, $3)`,
        [penilaian_id, d.bobot_id, d.nilai]
      )
    }

    await client.query('COMMIT')

    res.status(201).json({
      message: 'Penilaian berhasil disimpan',
      penilaian_id,
      skor_total
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Create penilaian error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  } finally {
    client.release()
  }
}

// ── GET /api/penilaian ────────────────────────────────────────────────────────
export const getAllPenilaian = async (req, res) => {
  const petugas_id = req.user.user_id
  const { periode_id, driver_id, status_validasi } = req.query

  try {
    const conditions = ['d.armada_id = pt.armada_id', 'pt.petugas_id = $1']
    const params = [petugas_id]
    let idx = 2

    if (periode_id) {
      conditions.push(`pn.periode_id = $${idx++}`)
      params.push(periode_id)
    }
    if (driver_id) {
      conditions.push(`pn.driver_id = $${idx++}`)
      params.push(driver_id)
    }
    if (status_validasi) {
      conditions.push(`pn.status_validasi = $${idx++}`)
      params.push(status_validasi)
    }

    const result = await pool.query(
      `SELECT
         pn.penilaian_id,
         pn.skor_total,
         pn.status_validasi,
         pn.catatan_petugas,
         pn.note_validasi,
         pn.created_at,
         pn.updated_at,
         d.driver_id,
         d.nama_driver,
         b.bus_id,
         b.kode_bus,
         b.nopol,
         p.periode_id,
         p.nama_periode,
         p.bulan,
         p.tahun,
         bf.bukti_id,
         bf.file_path,
         bf.nama_file
       FROM penilaian pn
       JOIN driver d   ON pn.driver_id  = d.driver_id
       JOIN bus b      ON pn.bus_id     = b.bus_id
       JOIN periode p  ON pn.periode_id = p.periode_id
       JOIN petugas pt ON pn.petugas_id = pt.petugas_id
       LEFT JOIN bukti_foto bf ON bf.penilaian_id = pn.penilaian_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY pn.created_at DESC`,
      params
    )

    res.json({ penilaians: result.rows })
  } catch (err) {
    console.error('Get all penilaian error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── GET /api/penilaian/:id ────────────────────────────────────────────────────
export const getPenilaianById = async (req, res) => {
  const { id } = req.params
  const petugas_id = req.user.user_id

  try {
    // Header penilaian
    const penilaianResult = await pool.query(
      `SELECT
         pn.penilaian_id,
         pn.skor_total,
         pn.status_validasi,
         pn.catatan_petugas,
         pn.note_validasi,
         pn.created_at,
         pn.updated_at,
         d.driver_id,
         d.nama_driver,
         d.nama_kernet,
         b.bus_id,
         b.kode_bus,
         b.nopol,
         p.periode_id,
         p.nama_periode,
         p.bulan,
         p.tahun,
         pt.petugas_id,
         pt.nama_petugas
       FROM penilaian pn
       JOIN driver d   ON pn.driver_id  = d.driver_id
       JOIN bus b      ON pn.bus_id     = b.bus_id
       JOIN periode p  ON pn.periode_id = p.periode_id
       JOIN petugas pt ON pn.petugas_id = pt.petugas_id
       WHERE pn.penilaian_id = $1 AND pn.petugas_id = $2`,
      [id, petugas_id]
    )

    if (penilaianResult.rows.length === 0) {
      return res.status(404).json({ message: 'Penilaian tidak ditemukan' })
    }

    // Detail per indikator
    const detailResult = await pool.query(
      `SELECT
         pd.penilaian_detail_id,
         pd.nilai,
         bw.bobot_id,
         bw.nama_bobot,
         bw.persentase_bobot
       FROM penilaian_detail pd
       JOIN bobot bw ON pd.bobot_id = bw.bobot_id
       WHERE pd.penilaian_id = $1
       ORDER BY bw.bobot_id`,
      [id]
    )

    // Foto bukti
    const fotoResult = await pool.query(
      'SELECT bukti_id, file_path, nama_file, uploaded_at FROM bukti_foto WHERE penilaian_id = $1',
      [id]
    )

    res.json({
      ...penilaianResult.rows[0],
      details: detailResult.rows,
      fotos: fotoResult.rows
    })
  } catch (err) {
    console.error('Get penilaian by id error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── PUT /api/penilaian/:id ────────────────────────────────────────────────────
export const updatePenilaian = async (req, res) => {
  const { id } = req.params
  const petugas_id = req.user.user_id
  const { catatan_petugas, details } = req.body

  if (!Array.isArray(details) || details.length === 0) {
    return res.status(400).json({ message: 'Detail penilaian tidak boleh kosong' })
  }
  for (const d of details) {
    if (!d.bobot_id || d.nilai === undefined || d.nilai === null) {
      return res.status(400).json({ message: 'Setiap detail harus memiliki bobot_id dan nilai' })
    }
    if (d.nilai < 0 || d.nilai > 100) {
      return res.status(400).json({ message: 'Nilai harus antara 0 dan 100' })
    }
  }

  const client = await pool.connect()
  try {
    // Cek ownership dan status
    const penilaianCheck = await client.query(
      `SELECT pn.penilaian_id, pn.status_validasi, p.siklus_id
       FROM penilaian pn
       JOIN periode p ON pn.periode_id = p.periode_id
       WHERE pn.penilaian_id = $1 AND pn.petugas_id = $2`,
      [id, petugas_id]
    )
    if (penilaianCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Penilaian tidak ditemukan' })
    }

    const { status_validasi, siklus_id } = penilaianCheck.rows[0]
    if (status_validasi === 'approved') {
      return res.status(403).json({ message: 'Penilaian yang sudah disetujui tidak dapat diubah' })
    }

    // Ambil bobot siklus untuk hitung ulang skor
    const bobotResult = await client.query(
      'SELECT bobot_id, persentase_bobot FROM bobot WHERE siklus_id = $1',
      [siklus_id]
    )
    const bobotMap = {}
    for (const b of bobotResult.rows) {
      bobotMap[b.bobot_id] = parseFloat(b.persentase_bobot)
    }

    for (const d of details) {
      if (bobotMap[d.bobot_id] === undefined) {
        return res.status(400).json({ message: `bobot_id ${d.bobot_id} tidak valid untuk siklus ini` })
      }
    }

    // Hitung ulang skor_total
    let skor_total = 0
    for (const d of details) {
      skor_total += (parseFloat(d.nilai) * bobotMap[d.bobot_id]) / 100
    }
    skor_total = Math.round(skor_total * 100) / 100

    await client.query('BEGIN')

    // Hapus detail lama, insert baru
    await client.query('DELETE FROM penilaian_detail WHERE penilaian_id = $1', [id])
    for (const d of details) {
      await client.query(
        `INSERT INTO penilaian_detail (penilaian_id, bobot_id, nilai)
         VALUES ($1, $2, $3)`,
        [id, d.bobot_id, d.nilai]
      )
    }

    // Update header — reset status ke pending
    await client.query(
      `UPDATE penilaian
       SET skor_total = $1, catatan_petugas = $2, status_validasi = 'pending', updated_at = NOW()
       WHERE penilaian_id = $3`,
      [skor_total, catatan_petugas || null, id]
    )

    await client.query('COMMIT')

    res.json({
      message: 'Penilaian berhasil diperbarui',
      penilaian_id: parseInt(id),
      skor_total
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Update penilaian error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  } finally {
    client.release()
  }
}

// ── DELETE /api/penilaian/:id ─────────────────────────────────────────────────
export const deletePenilaian = async (req, res) => {
  const { id } = req.params
  const petugas_id = req.user.user_id

  try {
    const penilaianCheck = await pool.query(
      'SELECT penilaian_id, status_validasi FROM penilaian WHERE penilaian_id = $1 AND petugas_id = $2',
      [id, petugas_id]
    )
    if (penilaianCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Penilaian tidak ditemukan' })
    }

    const { status_validasi } = penilaianCheck.rows[0]
    if (status_validasi === 'approved') {
      return res.status(403).json({ message: 'Penilaian yang sudah disetujui tidak dapat dihapus' })
    }

    // Hapus file foto dari Supabase Storage sebelum delete DB
    const fotoResult = await pool.query(
      'SELECT file_path FROM bukti_foto WHERE penilaian_id = $1', [id]
    )
    for (const foto of fotoResult.rows) {
      const relativePath = foto.file_path.split('/bukti-foto/')[1]
      if (relativePath) {
        await supabase.storage.from('bukti-foto').remove([relativePath])
      }
    }

    // CASCADE hapus penilaian_detail dan bukti_foto dari DB
    await pool.query('DELETE FROM penilaian WHERE penilaian_id = $1', [id])

    res.json({ message: 'Penilaian berhasil dihapus' })
  } catch (err) {
    console.error('Delete penilaian error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── POST /api/penilaian/:id/foto ──────────────────────────────────────────────
export const uploadFoto = async (req, res) => {
  const { id } = req.params
  const petugas_id = req.user.user_id

  if (!req.file) {
    return res.status(400).json({ message: 'File foto wajib disertakan' })
  }

  try {
    // Cek ownership penilaian
    const penilaianCheck = await pool.query(
      'SELECT penilaian_id, status_validasi FROM penilaian WHERE penilaian_id = $1 AND petugas_id = $2',
      [id, petugas_id]
    )
    if (penilaianCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Penilaian tidak ditemukan' })
    }
    if (penilaianCheck.rows[0].status_validasi === 'approved') {
      return res.status(403).json({ message: 'Penilaian yang sudah disetujui tidak dapat diubah' })
    }

    // Cek sudah ada foto (maks 1 per penilaian)
    const fotoCheck = await pool.query(
      'SELECT bukti_id FROM bukti_foto WHERE penilaian_id = $1',
      [id]
    )
    if (fotoCheck.rows.length > 0) {
      return res.status(409).json({ message: 'Penilaian sudah memiliki foto. Hapus foto lama terlebih dahulu.' })
    }

    // Upload ke Supabase Storage
    const ext = req.file.originalname.split('.').pop()
    const fileName = `penilaian_${id}/${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('bukti-foto')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      })

    if (uploadError) {
      console.error('Supabase upload error:', uploadError)
      return res.status(500).json({ message: 'Gagal mengupload foto ke storage' })
    }

    // Ambil public URL
    const { data: urlData } = supabase.storage
      .from('bukti-foto')
      .getPublicUrl(fileName)

    // Simpan ke DB
    const result = await pool.query(
      `INSERT INTO bukti_foto (penilaian_id, file_path, nama_file)
       VALUES ($1, $2, $3)
       RETURNING bukti_id, file_path, nama_file, uploaded_at`,
      [id, urlData.publicUrl, req.file.originalname]
    )

    res.status(201).json({
      message: 'Foto berhasil diupload',
      foto: result.rows[0]
    })
  } catch (err) {
    console.error('Upload foto error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── DELETE /api/foto/:buktiId ─────────────────────────────────────────────────
export const deleteFoto = async (req, res) => {
  const { buktiId } = req.params
  const petugas_id = req.user.user_id

  try {
    // Ambil data foto + validasi ownership lewat join ke penilaian
    const fotoResult = await pool.query(
      `SELECT bf.bukti_id, bf.file_path, pn.status_validasi
       FROM bukti_foto bf
       JOIN penilaian pn ON bf.penilaian_id = pn.penilaian_id
       WHERE bf.bukti_id = $1 AND pn.petugas_id = $2`,
      [buktiId, petugas_id]
    )

    if (fotoResult.rows.length === 0) {
      return res.status(404).json({ message: 'Foto tidak ditemukan' })
    }

    const { file_path, status_validasi } = fotoResult.rows[0]
    if (status_validasi === 'approved') {
      return res.status(403).json({ message: 'Foto penilaian yang sudah disetujui tidak dapat dihapus' })
    }

    // Ekstrak path relatif dari public URL untuk delete di Storage
    // URL format: https://xxx.supabase.co/storage/v1/object/public/bukti-foto/penilaian_1/xxx.jpg
    const relativePath = file_path.split('/bukti-foto/')[1]

    if (relativePath) {
      const { error: deleteError } = await supabase.storage
        .from('bukti-foto')
        .remove([relativePath])

      if (deleteError) {
        console.error('Supabase delete error:', deleteError)
        // Lanjut hapus dari DB meski storage error
      }
    }

    await pool.query('DELETE FROM bukti_foto WHERE bukti_id = $1', [buktiId])

    res.json({ message: 'Foto berhasil dihapus' })
  } catch (err) {
    console.error('Delete foto error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}
