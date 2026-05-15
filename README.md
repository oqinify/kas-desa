# Kas Desa - Sistem Keuangan Kantor

Sistem manajemen keuangan kantor desa minimalis berbasis **Google Apps Script** + **Google Sheets** yang bisa di-host di **GitHub Pages**.

## 🏗️ Arsitektur

```
┌──────────────────┐     fetch()      ┌──────────────────┐
│   GitHub Pages   │ ◄──────────────► │  Google Apps      │
│   (index.html)   │   GET/POST JSON  │  Script (API)    │
└──────────────────┘                  └────────┬─────────┘
                                               │
                                      ┌────────▼─────────┐
                                      │  Google Sheets   │
                                      │  (Database)      │
                                      └──────────────────┘
```

## 📁 Struktur File

| File | Keterangan |
|------|-----------|
| `index.html` | Halaman utama (GitHub Pages) |
| `styles.css` | Stylesheet dengan dark mode |
| `app.js` | Logic frontend (dual-mode: lokal & online) |
| `Code.gs` | Backend Google Apps Script |

## 🚀 Cara Deploy

### 1. Deploy Google Apps Script

1. Buka [Google Apps Script](https://script.google.com) → **New Project**
2. Salin isi `Code.gs` ke editor
3. Isi `SPREADSHEET_ID` di `CONFIG` dengan ID Google Sheet Anda
4. Klik **Deploy** → **New deployment** → **Web app**
5. Set **Execute as**: Me, **Who has access**: Anyone
6. Salin URL deployment

### 2. Deploy ke GitHub Pages

1. Buat repository baru di GitHub
2. Upload `index.html`, `styles.css`, `app.js`
3. Buka **Settings** → **Pages** → pilih branch `main`
4. Akses website di `https://username.github.io/repo-name`
5. Buka **Pengaturan** di app → masukkan URL GAS

### 3. Inisialisasi Database

Jalankan fungsi `initDatabase()` di Apps Script Editor untuk membuat sheet dan data awal.

## ✨ Fitur

- **Dashboard** dengan statistik real-time dan chart
- **CRUD Transaksi** — pemasukan & pengeluaran
- **Multi Sumber Dana** — DD, ADD, PAD, dll
- **Approval Workflow** — transaksi besar butuh persetujuan
- **Laporan Keuangan** per sumber dana
- **Dark/Light Mode**
- **Responsive** — desktop & mobile
- **Mode Lokal** — bisa dipakai tanpa koneksi GAS (data sementara)
