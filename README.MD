# Koeta Backend

Backend service untuk aplikasi **Koeta**, dibangun untuk menangani autentikasi, manajemen data, dan integrasi API.

## Fitur Utama

- REST API untuk kebutuhan aplikasi
- Autentikasi dan otorisasi pengguna
- Validasi request dan penanganan error
- Integrasi database
- Konfigurasi environment per deployment


- Node.js
- Express.js
- Database (PostgreSQL/MySQL/MongoDB)
- ORM/Query Builder (Prisma/Sequelize/TypeORM)

## Struktur Direktori (Contoh)

```bash
koeta-backend/
├── src/
│   ├── config/
│   ├── controllers/
│   ├── middlewares/
│   ├── models/
│   ├── routes/
│   ├── services/
│   └── app.js
├── .env.example
├── package.json
└── README.md
```

## Persiapan

Pastikan sudah terpasang:

- Node.js (disarankan versi LTS)
- Package manager: `npm` / `yarn` / `pnpm`
- Database sesuai konfigurasi proyek

## Instalasi

```bash
# clone repository (jika belum)
git clone <url-repository>

# masuk ke folder backend
cd koeta-backend

# install dependencies
npm install
```

## Konfigurasi Environment

1. Salin file contoh environment:

```bash
cp .env.example .env
```

2. Isi nilai variabel yang dibutuhkan, contoh:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=your_database_url
JWT_SECRET=your_jwt_secret
```

## Menjalankan Aplikasi

```bash
# mode development
npm run dev

# mode production
npm start
```

Backend akan berjalan di:

```text
http://localhost:3000
```

## Scripts Umum

```bash
npm run dev      # jalankan server development
npm start        # jalankan server production
npm run test     # jalankan testing
npm run lint     # cek style/lint
```

## Endpoint Dasar (Contoh)

- `GET /health` — cek status server
- `POST /auth/login` — login pengguna
- `POST /auth/register` — registrasi pengguna

> Dokumentasi endpoint lengkap dapat ditambahkan melalui Postman Collection / Swagger.

## Kontribusi

1. Buat branch baru dari `main`
2. Commit perubahan dengan pesan yang jelas
3. Buat Pull Request

