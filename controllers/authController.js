import jwt from 'jsonwebtoken'
import pool from '../config/db.js'

export const login = async (req, res) => {
  const { identifier, password } = req.body

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Identifier dan password wajib diisi' })
  }

  try {
    let user = null
    let role = null

    // 1. Cek tabel admin (login dengan nomor_pegawai atau username)
    const adminResult = await pool.query(
      `SELECT admin_id AS id, nama_admin AS nama, nomor_pegawai, status_aktif,
              role, armada_id,
              (password = crypt($1, password)) AS password_valid
       FROM admin WHERE nomor_pegawai = $2 OR username = $2`,
      [password, identifier]
    )
    if (adminResult.rows.length > 0) {
      user = adminResult.rows[0]
      role = user.role // 'super_admin' atau 'admin'
    }

    // 2. Cek tabel petugas (login dengan nomor_pegawai atau username)
    if (!user) {
      const petugasResult = await pool.query(
        `SELECT petugas_id AS id, nama_petugas AS nama, nomor_pegawai, status_aktif, armada_id,
                (password = crypt($1, password)) AS password_valid
         FROM petugas WHERE nomor_pegawai = $2 OR username = $2`,
        [password, identifier]
      )
      if (petugasResult.rows.length > 0) {
        user = petugasResult.rows[0]
        role = 'petugas'
      }
    }

    // 3. Cek tabel driver (login dengan username)
    if (!user) {
      const driverResult = await pool.query(
        `SELECT driver_id AS id, nama_driver AS nama, username, status_aktif,
                (password = crypt($1, password)) AS password_valid
         FROM driver WHERE username = $2`,
        [password, identifier]
      )
      if (driverResult.rows.length > 0) {
        user = driverResult.rows[0]
        role = 'driver'
      }
    }

    // 4. User tidak ditemukan
    if (!user) {
      return res.status(401).json({ message: 'Username/Nomor Pegawai atau password salah' })
    }

    // 5. Verifikasi password
    if (!user.password_valid) {
      return res.status(401).json({ message: 'Username/Nomor Pegawai atau password salah' })
    }

    // 6. Cek status aktif
    if (user.status_aktif !== 'aktif') {
      return res.status(403).json({ message: 'Akun Anda tidak aktif' })
    }

    // 7. Generate JWT
    const jwtPayload = {
      user_id: user.id,
      role,
      armada_id: user.armada_id ?? null
    }

    const token = jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: '8h' })

    const responseUser = {
      id: user.id,
      nama: user.nama,
      role,
      armada_id: user.armada_id ?? null
    }

    res.json({ token, user: responseUser })

  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ message: 'Terjadi kesalahan server' })
  }
}
