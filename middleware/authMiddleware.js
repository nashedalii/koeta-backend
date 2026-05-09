import jwt from 'jsonwebtoken'

export const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization']

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token tidak ditemukan' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded // { user_id, role, armada_id }
    next()
  } catch (err) {
    return res.status(401).json({ message: 'Token tidak valid atau sudah expired' })
  }
}

// Cek role tertentu (admin, petugas, driver, super_admin)
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Akses ditolak' })
    }
    next()
  }
}

// Hanya super_admin yang boleh akses
export const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ message: 'Hanya super admin yang dapat mengakses fitur ini' })
  }
  next()
}

// Inject armada filter ke req:
// - super_admin: req.armadaId = null (tidak difilter), req.isSuperAdmin = true
// - admin vendor: req.armadaId = armada_id dari JWT
export const filterArmada = (req, res, next) => {
  const { role, armada_id } = req.user

  if (role === 'super_admin') {
    req.isSuperAdmin = true
    req.armadaId = null
  } else if (role === 'admin') {
    req.isSuperAdmin = false
    req.armadaId = armada_id
  } else {
    return res.status(403).json({ message: 'Akses ditolak' })
  }

  next()
}
