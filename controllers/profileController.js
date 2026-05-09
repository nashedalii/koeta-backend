import pool from '../config/db.js'
import supabase from '../config/supabase.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const TABLE_MAP = {
  petugas: { table: 'petugas', idCol: 'petugas_id', namaCol: 'nama_petugas' },
  driver:  { table: 'driver',  idCol: 'driver_id',  namaCol: 'nama_driver'  },
}

// ── GET /api/profile/me ───────────────────────────────────────────────────────
export const getMyProfile = async (req, res) => {
  const { role, user_id } = req.user

  try {
    let result

    if (role === 'petugas') {
      result = await pool.query(`
        SELECT
          p.petugas_id  AS id,
          p.nama_petugas AS nama,
          p.nomor_pegawai,
          p.username,
          p.no_hp,
          p.foto_profil,
          p.status_aktif,
          a.nama_armada,
          a.kode_armada
        FROM petugas p
        LEFT JOIN armada a ON p.armada_id = a.armada_id
        WHERE p.petugas_id = $1
      `, [user_id])

    } else if (role === 'driver') {
      result = await pool.query(`
        SELECT
          d.driver_id   AS id,
          d.nama_driver  AS nama,
          d.nama_kernet,
          d.username,
          d.no_hp,
          d.foto_profil,
          d.status_aktif,
          a.nama_armada,
          a.kode_armada,
          b.kode_bus,
          b.nopol
        FROM driver d
        LEFT JOIN armada a ON d.armada_id = a.armada_id
        LEFT JOIN bus    b ON b.driver_id = d.driver_id AND b.status_aktif = 'aktif'
        WHERE d.driver_id = $1
      `, [user_id])

    } else {
      return res.status(403).json({ message: 'Role tidak didukung untuk endpoint ini' })
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Profil tidak ditemukan' })
    }

    res.json({ ...result.rows[0], role })
  } catch (err) {
    console.error('Get profile error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── PUT /api/profile/me ───────────────────────────────────────────────────────
// Update username & no_hp milik sendiri
export const updateMyProfile = async (req, res) => {
  const { role, user_id } = req.user
  const { username, no_hp } = req.body

  if (!username && !no_hp) {
    return res.status(400).json({ message: 'Minimal satu field (username / no HP) harus diisi' })
  }

  if (!TABLE_MAP[role]) {
    return res.status(403).json({ message: 'Role tidak didukung untuk endpoint ini' })
  }

  const { table, idCol, namaCol } = TABLE_MAP[role]
  const fields = []
  const values = []
  let idx = 1

  if (username) { fields.push(`username = $${idx++}`); values.push(username) }
  if (no_hp)    { fields.push(`no_hp = $${idx++}`);    values.push(no_hp) }

  values.push(user_id)

  try {
    const result = await pool.query(
      `UPDATE ${table} SET ${fields.join(', ')} WHERE ${idCol} = $${idx}
       RETURNING ${idCol} AS id, ${namaCol} AS nama, username, no_hp`,
      values
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Profil tidak ditemukan' })
    }

    res.json({ message: 'Profil berhasil diupdate', user: { ...result.rows[0], role } })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Username atau no HP sudah digunakan' })
    }
    console.error('Update profile error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── PUT /api/profile/me/foto ──────────────────────────────────────────────────
// Upload / ganti foto profil
export const updateMyFoto = async (req, res) => {
  const { role, user_id } = req.user

  if (!req.file) {
    return res.status(400).json({ message: 'File foto wajib disertakan' })
  }

  if (!TABLE_MAP[role]) {
    return res.status(403).json({ message: 'Role tidak didukung untuk endpoint ini' })
  }

  const { table, idCol } = TABLE_MAP[role]
  const ext      = req.file.mimetype.split('/')[1]
  const fileName = `${role}/${user_id}.${ext}`

  try {
    // Hapus foto lama dari storage jika ada
    const existing = await pool.query(
      `SELECT foto_profil FROM ${table} WHERE ${idCol} = $1`, [user_id]
    )
    const oldUrl = existing.rows[0]?.foto_profil
    if (oldUrl) {
      const oldPath = oldUrl.split('/foto-profil/')[1]
      if (oldPath) await supabase.storage.from('foto-profil').remove([oldPath])
    }

    // Upload foto baru ke Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('foto-profil')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      })

    if (uploadError) {
      console.error('Supabase upload error:', uploadError)
      return res.status(500).json({ message: 'Gagal mengupload foto ke storage' })
    }

    const { data: urlData } = supabase.storage.from('foto-profil').getPublicUrl(fileName)
    const publicUrl = urlData.publicUrl

    // Simpan URL ke database
    await pool.query(
      `UPDATE ${table} SET foto_profil = $1 WHERE ${idCol} = $2`,
      [publicUrl, user_id]
    )

    res.json({ message: 'Foto profil berhasil diupdate', foto_profil: publicUrl })
  } catch (err) {
    console.error('Update foto error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── DELETE /api/profile/me/foto ───────────────────────────────────────────────
// Hapus foto profil — hilang dari storage & DB
export const deleteMyFoto = async (req, res) => {
  const { role, user_id } = req.user

  if (!TABLE_MAP[role]) {
    return res.status(403).json({ message: 'Role tidak didukung untuk endpoint ini' })
  }

  const { table, idCol } = TABLE_MAP[role]

  try {
    const existing = await pool.query(
      `SELECT foto_profil FROM ${table} WHERE ${idCol} = $1`, [user_id]
    )
    const oldUrl = existing.rows[0]?.foto_profil

    if (!oldUrl) {
      return res.status(404).json({ message: 'Tidak ada foto profil untuk dihapus' })
    }

    // Hapus dari Supabase Storage
    const oldPath = oldUrl.split('/foto-profil/')[1]
    if (oldPath) {
      await supabase.storage.from('foto-profil').remove([oldPath])
    }

    // Hapus URL dari DB
    await pool.query(
      `UPDATE ${table} SET foto_profil = NULL WHERE ${idCol} = $1`, [user_id]
    )

    res.json({ message: 'Foto profil berhasil dihapus' })
  } catch (err) {
    console.error('Delete foto error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// ── PUT /api/profile/me/password ──────────────────────────────────────────────
// Ganti password — wajib verifikasi password lama
export const updateMyPassword = async (req, res) => {
  const { role, user_id } = req.user
  const { password_lama, password_baru } = req.body

  if (!password_lama || !password_baru) {
    return res.status(400).json({ message: 'Password lama dan password baru wajib diisi' })
  }

  if (password_baru.length < 6) {
    return res.status(400).json({ message: 'Password baru minimal 6 karakter' })
  }

  if (!TABLE_MAP[role]) {
    return res.status(403).json({ message: 'Role tidak didukung untuk endpoint ini' })
  }

  const { table, idCol } = TABLE_MAP[role]

  try {
    // Verifikasi password lama
    const verify = await pool.query(
      `SELECT ${idCol} FROM ${table} WHERE ${idCol} = $1 AND password = crypt($2, password)`,
      [user_id, password_lama]
    )

    if (verify.rows.length === 0) {
      return res.status(401).json({ message: 'Password lama tidak sesuai' })
    }

    // Update ke password baru
    await pool.query(
      `UPDATE ${table} SET password = crypt($1, gen_salt('bf')) WHERE ${idCol} = $2`,
      [password_baru, user_id]
    )

    res.json({ message: 'Password berhasil diubah' })
  } catch (err) {
    console.error('Update password error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}
