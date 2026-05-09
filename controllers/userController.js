import pool from '../config/db.js'

const generatePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let password = ''
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

// POST /api/users/admin  — hanya super_admin
export const createAdmin = async (req, res) => {
  const { nama_admin, nomor_pegawai, username, no_hp, armada_id, role: newRole } = req.body

  if (!nama_admin || !nomor_pegawai || !username || !no_hp) {
    return res.status(400).json({ message: 'Semua field wajib diisi' })
  }

  const adminRole = newRole === 'super_admin' ? 'super_admin' : 'admin'
  // admin vendor wajib punya armada_id
  if (adminRole === 'admin' && !armada_id) {
    return res.status(400).json({ message: 'armada_id wajib diisi untuk admin vendor' })
  }

  const password = generatePassword()

  try {
    const result = await pool.query(
      `INSERT INTO admin (nama_admin, nomor_pegawai, username, no_hp, password, role, armada_id)
       VALUES ($1, $2, $3, $4, crypt($5, gen_salt('bf')), $6, $7)
       RETURNING admin_id AS id, nama_admin AS nama, username, role`,
      [nama_admin, nomor_pegawai, username, no_hp, password, adminRole, armada_id || null]
    )

    res.status(201).json({
      message: 'Admin berhasil dibuat',
      user: result.rows[0],
      password_awal: password
    })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Nomor pegawai, username, atau no HP sudah digunakan' })
    }
    console.error('Create admin error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// POST /api/users/petugas
export const createPetugas = async (req, res) => {
  const { role: callerRole, armada_id: callerArmadaId } = req.user
  const { nama_petugas, nomor_pegawai, username, no_hp } = req.body
  let { armada_id } = req.body

  // admin vendor wajib pakai armada_id dari JWT
  if (callerRole !== 'super_admin') {
    armada_id = callerArmadaId
  }

  if (!nama_petugas || !nomor_pegawai || !username || !no_hp || !armada_id) {
    return res.status(400).json({ message: 'Semua field wajib diisi' })
  }

  const password = generatePassword()

  try {
    const result = await pool.query(
      `INSERT INTO petugas (nama_petugas, nomor_pegawai, username, no_hp, password, armada_id)
       VALUES ($1, $2, $3, $4, crypt($5, gen_salt('bf')), $6)
       RETURNING petugas_id AS id, nama_petugas AS nama, username`,
      [nama_petugas, nomor_pegawai, username, no_hp, password, armada_id]
    )

    res.status(201).json({
      message: 'Petugas berhasil dibuat',
      user: { ...result.rows[0], role: 'petugas' },
      password_awal: password
    })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Nomor pegawai, username, atau no HP sudah digunakan' })
    }
    console.error('Create petugas error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// PUT /api/users/admin/:id/reset-password
export const resetAdminPassword = async (req, res) => {
  const { id } = req.params
  const { role: callerRole } = req.user
  const password = generatePassword()

  // admin vendor tidak bisa reset password admin lain
  if (callerRole !== 'super_admin') {
    return res.status(403).json({ message: 'Hanya super admin yang dapat mereset password admin' })
  }

  try {
    const result = await pool.query(
      `UPDATE admin SET password = crypt($1, gen_salt('bf'))
       WHERE admin_id = $2
       RETURNING admin_id AS id, username`,
      [password, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Admin tidak ditemukan' })
    }

    res.json({
      message: 'Password berhasil direset',
      user: { ...result.rows[0], role: 'admin' },
      password_baru: password
    })
  } catch (err) {
    console.error('Reset admin password error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// PUT /api/users/petugas/:id/reset-password
export const resetPetugasPassword = async (req, res) => {
  const { id } = req.params
  const { role: callerRole, armada_id: callerArmadaId } = req.user
  const password = generatePassword()

  // admin vendor hanya bisa reset password petugas di armadanya
  if (callerRole !== 'super_admin') {
    const check = await pool.query(`SELECT armada_id FROM petugas WHERE petugas_id = $1`, [id])
    if (check.rows.length === 0) return res.status(404).json({ message: 'Petugas tidak ditemukan' })
    if (check.rows[0].armada_id !== callerArmadaId) return res.status(403).json({ message: 'Akses ditolak' })
  }

  try {
    const result = await pool.query(
      `UPDATE petugas SET password = crypt($1, gen_salt('bf'))
       WHERE petugas_id = $2
       RETURNING petugas_id AS id, username`,
      [password, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Petugas tidak ditemukan' })
    }

    res.json({
      message: 'Password berhasil direset',
      user: { ...result.rows[0], role: 'petugas' },
      password_baru: password
    })
  } catch (err) {
    console.error('Reset petugas password error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// PUT /api/users/driver/:id/reset-password
export const resetDriverPassword = async (req, res) => {
  const { id } = req.params
  const { role: callerRole, armada_id: callerArmadaId } = req.user
  const password = generatePassword()

  // admin vendor hanya bisa reset password driver di armadanya
  if (callerRole !== 'super_admin') {
    const check = await pool.query(`SELECT armada_id FROM driver WHERE driver_id = $1`, [id])
    if (check.rows.length === 0) return res.status(404).json({ message: 'Driver tidak ditemukan' })
    if (check.rows[0].armada_id !== callerArmadaId) return res.status(403).json({ message: 'Akses ditolak' })
  }

  try {
    const result = await pool.query(
      `UPDATE driver SET password = crypt($1, gen_salt('bf'))
       WHERE driver_id = $2
       RETURNING driver_id AS id, username`,
      [password, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Driver tidak ditemukan' })
    }

    res.json({
      message: 'Password berhasil direset',
      user: { ...result.rows[0], role: 'driver' },
      password_baru: password
    })
  } catch (err) {
    console.error('Reset driver password error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// GET /api/users
export const getAllUsers = async (req, res) => {
  const { role: callerRole, armada_id: callerArmadaId } = req.user

  try {
    let adminResult = { rows: [] }
    let petugasResult
    let driverResult

    if (callerRole === 'super_admin') {
      // Super admin melihat semua admin
      adminResult = await pool.query(
        `SELECT admin_id AS id, nama_admin AS nama, nomor_pegawai AS identifier,
                no_hp, status_aktif, role,
                a.kode_armada, a.nama_armada
         FROM admin
         LEFT JOIN armada a ON admin.armada_id = a.armada_id`
      )

      petugasResult = await pool.query(
        `SELECT p.petugas_id AS id, p.nama_petugas AS nama, p.nomor_pegawai AS identifier,
                p.no_hp, p.status_aktif, 'petugas' AS role,
                a.kode_armada, a.nama_armada
         FROM petugas p
         LEFT JOIN armada a ON p.armada_id = a.armada_id`
      )

      driverResult = await pool.query(
        `SELECT d.driver_id AS id, d.nama_driver AS nama, d.username AS identifier,
                d.nama_kernet, d.no_hp, d.status_aktif, 'driver' AS role,
                a.armada_id, a.kode_armada, a.nama_armada,
                b.bus_id, b.kode_bus, b.nopol, b.status_aktif AS bus_status,
                k.koridor_id, k.nama_koridor, k.tipe AS tipe_koridor
         FROM driver d
         LEFT JOIN armada a ON d.armada_id = a.armada_id
         LEFT JOIN bus b ON b.driver_id = d.driver_id
         LEFT JOIN koridor k ON d.koridor_id = k.koridor_id`
      )
    } else {
      // Admin vendor hanya melihat petugas & driver di armadanya
      petugasResult = await pool.query(
        `SELECT p.petugas_id AS id, p.nama_petugas AS nama, p.nomor_pegawai AS identifier,
                p.no_hp, p.status_aktif, 'petugas' AS role,
                a.kode_armada, a.nama_armada
         FROM petugas p
         LEFT JOIN armada a ON p.armada_id = a.armada_id
         WHERE p.armada_id = $1`,
        [callerArmadaId]
      )

      driverResult = await pool.query(
        `SELECT d.driver_id AS id, d.nama_driver AS nama, d.username AS identifier,
                d.nama_kernet, d.no_hp, d.status_aktif, 'driver' AS role,
                a.armada_id, a.kode_armada, a.nama_armada,
                b.bus_id, b.kode_bus, b.nopol, b.status_aktif AS bus_status,
                k.koridor_id, k.nama_koridor, k.tipe AS tipe_koridor
         FROM driver d
         LEFT JOIN armada a ON d.armada_id = a.armada_id
         LEFT JOIN bus b ON b.driver_id = d.driver_id
         LEFT JOIN koridor k ON d.koridor_id = k.koridor_id
         WHERE d.armada_id = $1`,
        [callerArmadaId]
      )
    }

    const users = [
      ...adminResult.rows,
      ...petugasResult.rows,
      ...driverResult.rows
    ]

    res.json(users)
  } catch (err) {
    console.error('Get all users error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// GET /api/users/driver?armada_id=1
export const getAllDrivers = async (req, res) => {
  const { role: callerRole, armada_id: callerArmadaId } = req.user

  // Tentukan filter armada: admin vendor wajib pakai armadanya
  let effectiveArmadaId
  if (callerRole === 'super_admin') {
    effectiveArmadaId = req.query.armada_id ? parseInt(req.query.armada_id) : null
  } else {
    effectiveArmadaId = callerArmadaId
  }

  try {
    let query = `
      SELECT d.driver_id AS id, d.nama_driver AS nama, d.nama_kernet,
             d.username, d.no_hp, d.status_aktif,
             a.armada_id, a.kode_armada, a.nama_armada,
             b.bus_id, b.kode_bus, b.nopol, b.status_aktif AS bus_status,
             k.koridor_id, k.nama_koridor, k.tipe AS tipe_koridor
      FROM driver d
      LEFT JOIN armada a ON d.armada_id = a.armada_id
      LEFT JOIN bus b ON b.driver_id = d.driver_id
      LEFT JOIN koridor k ON d.koridor_id = k.koridor_id
    `
    const params = []

    if (effectiveArmadaId) {
      query += ' WHERE d.armada_id = $1'
      params.push(effectiveArmadaId)
    }

    query += ' ORDER BY a.kode_armada, d.nama_driver'

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error('Get all drivers error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// PUT /api/users/:role/:id
const VALID_ROLES = ['admin', 'petugas', 'driver']

const TABLE_MAP = {
  admin:   { table: 'admin',   idCol: 'admin_id',   namaCol: 'nama_admin',   identifierCol: 'nomor_pegawai' },
  petugas: { table: 'petugas', idCol: 'petugas_id', namaCol: 'nama_petugas', identifierCol: 'nomor_pegawai' },
  driver:  { table: 'driver',  idCol: 'driver_id',  namaCol: 'nama_driver',  identifierCol: 'username'      }
}

// Validasi akses armada sebelum update/delete
async function checkArmadaAccess(role, table, idCol, id, callerRole, callerArmadaId) {
  if (callerRole === 'super_admin') return true
  if (role === 'admin') return false // admin vendor tidak bisa edit admin lain

  const check = await pool.query(`SELECT armada_id FROM ${table} WHERE ${idCol} = $1`, [id])
  if (check.rows.length === 0) return null // tidak ditemukan
  return check.rows[0].armada_id === callerArmadaId
}

export const updateUser = async (req, res) => {
  const { role, id } = req.params
  const { role: callerRole, armada_id: callerArmadaId } = req.user
  const { nama, identifier, no_hp, status_aktif, armada_id, nama_kernet, bus_id } = req.body

  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ message: 'Role tidak valid. Gunakan: admin, petugas, driver' })
  }

  const { table, idCol, namaCol, identifierCol } = TABLE_MAP[role]

  // Cek akses armada
  const access = await checkArmadaAccess(role, table, idCol, id, callerRole, callerArmadaId)
  if (access === null) return res.status(404).json({ message: 'User tidak ditemukan' })
  if (access === false) return res.status(403).json({ message: 'Akses ditolak' })

  const fields = []
  const values = []
  let idx = 1

  if (nama !== undefined)        { fields.push(`${namaCol} = $${idx++}`);       values.push(nama) }
  if (identifier !== undefined)  { fields.push(`${identifierCol} = $${idx++}`); values.push(identifier) }
  if (no_hp !== undefined)       { fields.push(`no_hp = $${idx++}`);            values.push(no_hp) }
  if (status_aktif !== undefined){ fields.push(`status_aktif = $${idx++}`);     values.push(status_aktif) }
  if (armada_id !== undefined && role !== 'admin') {
    fields.push(`armada_id = $${idx++}`)
    values.push(armada_id)
  }
  if (nama_kernet !== undefined && role === 'driver') {
    fields.push(`nama_kernet = $${idx++}`)
    values.push(nama_kernet)
  }
  if (req.body.koridor_id !== undefined && role === 'driver') {
    fields.push(`koridor_id = $${idx++}`)
    values.push(req.body.koridor_id || null)
  }

  if (fields.length === 0 && bus_id === undefined) {
    return res.status(400).json({ message: 'Tidak ada field yang diupdate' })
  }

  try {
    let result = { rows: [] }

    if (fields.length > 0) {
      values.push(id)
      result = await pool.query(
        `UPDATE ${table} SET ${fields.join(', ')} WHERE ${idCol} = $${idx} RETURNING ${idCol} AS id, ${namaCol} AS nama, status_aktif`,
        values
      )

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'User tidak ditemukan' })
      }
    }

    // Jika driver dinonaktifkan, lepas bus yang terikat
    if (role === 'driver' && status_aktif === 'nonaktif') {
      await pool.query('UPDATE bus SET driver_id = NULL WHERE driver_id = $1', [id])
    }

    // Assignment bus untuk driver: lepas bus lama, pasang bus baru
    if (role === 'driver' && bus_id !== undefined && status_aktif !== 'nonaktif') {
      await pool.query('UPDATE bus SET driver_id = NULL WHERE driver_id = $1', [id])
      if (bus_id) {
        await pool.query('UPDATE bus SET driver_id = $1 WHERE bus_id = $2', [id, bus_id])
      }
    }

    if (result.rows.length === 0 && fields.length === 0) {
      const refetch = await pool.query(
        `SELECT ${idCol} AS id, ${namaCol} AS nama, status_aktif FROM ${table} WHERE ${idCol} = $1`,
        [id]
      )
      if (refetch.rows.length === 0) return res.status(404).json({ message: 'User tidak ditemukan' })
      return res.json({ message: 'User berhasil diupdate', user: { ...refetch.rows[0], role } })
    }

    res.json({
      message: 'User berhasil diupdate',
      user: { ...result.rows[0], role }
    })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Identifier atau no HP sudah digunakan' })
    }
    console.error('Update user error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// DELETE /api/users/:role/:id
export const deleteUser = async (req, res) => {
  const { role, id } = req.params
  const { role: callerRole, armada_id: callerArmadaId, user_id: callerId } = req.user

  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ message: 'Role tidak valid. Gunakan: admin, petugas, driver' })
  }

  const { table, idCol, namaCol } = TABLE_MAP[role]

  // Cegah self-deletion: tabel admin mencakup super_admin dan admin
  const callerTable = ['super_admin', 'admin'].includes(callerRole) ? 'admin' : callerRole
  if (callerTable === table && callerId === parseInt(id)) {
    return res.status(403).json({ message: 'Tidak dapat menghapus akun sendiri' })
  }

  // Cek akses armada
  const access = await checkArmadaAccess(role, table, idCol, id, callerRole, callerArmadaId)
  if (access === null) return res.status(404).json({ message: 'User tidak ditemukan' })
  if (access === false) return res.status(403).json({ message: 'Akses ditolak' })

  try {
    const result = await pool.query(
      `DELETE FROM ${table} WHERE ${idCol} = $1 RETURNING ${idCol} AS id, ${namaCol} AS nama`,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User tidak ditemukan' })
    }

    res.json({
      message: 'User berhasil dihapus',
      user: { ...result.rows[0], role }
    })
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ message: 'User tidak bisa dihapus karena masih memiliki data terkait' })
    }
    console.error('Delete user error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}

// POST /api/users/driver
export const createDriver = async (req, res) => {
  const { role: callerRole, armada_id: callerArmadaId } = req.user
  const { nama_driver, nama_kernet, username, no_hp, koridor_id } = req.body
  let { armada_id } = req.body

  // admin vendor wajib pakai armada_id dari JWT
  if (callerRole !== 'super_admin') {
    armada_id = callerArmadaId
  }

  if (!nama_driver || !username || !no_hp || !armada_id) {
    return res.status(400).json({ message: 'Semua field wajib diisi' })
  }

  const password = generatePassword()

  try {
    const result = await pool.query(
      `INSERT INTO driver (nama_driver, nama_kernet, username, no_hp, password, armada_id, koridor_id)
       VALUES ($1, $2, $3, $4, crypt($5, gen_salt('bf')), $6, $7)
       RETURNING driver_id AS id, nama_driver AS nama, username`,
      [nama_driver, nama_kernet || null, username, no_hp, password, armada_id, koridor_id || null]
    )

    res.status(201).json({
      message: 'Driver berhasil dibuat',
      user: { ...result.rows[0], role: 'driver' },
      password_awal: password
    })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Username atau no HP sudah digunakan' })
    }
    console.error('Create driver error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}
