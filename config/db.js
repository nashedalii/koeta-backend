import pkg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool, types } = pkg

// Kembalikan DATE (OID 1082) sebagai string "YYYY-MM-DD" agar tidak kena timezone shift
types.setTypeParser(1082, (val) => val)

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
})

export default pool
