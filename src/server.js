// src/server.js
// Entry point - IT Inventory Management API

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');

const inventoryRoutes    = require('./routes/inventory.routes');
const { errorHandler }   = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
// MIDDLEWARE GLOBAL
// ─────────────────────────────────────────
app.use(cors({
  origin: '*',   // izinkan semua origin (Vercel, localhost, dll)
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors()); // handle preflight request
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'IT Inventory Management API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────
app.use('/api/v1', inventoryRoutes);

// ─────────────────────────────────────────
// ROOT: Dokumentasi endpoint
// ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'IT Inventory Management API',
    version: '1.0.0',
    endpoints: {
      'GET  /api/v1/stok':          'Daftar semua stok (support filter & pencarian)',
      'GET  /api/v1/stok/:id':      'Detail produk + riwayat transaksi',
      'POST /api/v1/stok-masuk':    'Catat barang masuk (tambah stok)',
      'POST /api/v1/stok-keluar':   'Catat barang keluar (kurangi stok)',
      'GET  /api/v1/alert':         'Item dengan stok di bawah minimum',
      'GET  /api/v1/riwayat':       'Riwayat semua transaksi',
      'GET  /health':               'Health check',
    },
    queryParams: {
      '/stok': {
        search:      'Cari berdasarkan nama/SKU/model printer',
        categoryId:  'Filter berdasarkan ID kategori',
        brandId:     'Filter berdasarkan ID brand',
        printerModel:'Filter berdasarkan nama model printer',
        lowStock:    'true = tampilkan hanya stok menipis',
        page:        'Halaman (default: 1)',
        limit:       'Jumlah per halaman (default: 20, max: 100)',
      },
      '/alert': {
        threshold: 'Override batas minimum stok (default: per-item minStock)',
      },
      '/riwayat': {
        type:  '"masuk" | "keluar" | kosong = semua',
        page:  'Halaman (default: 1)',
        limit: 'Jumlah per halaman (default: 20)',
      },
    },
  });
});

// ─────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `Endpoint "${req.method} ${req.originalUrl}" tidak ditemukan`,
  });
});

// ─────────────────────────────────────────
// ERROR HANDLER (harus paling akhir)
// ─────────────────────────────────────────
app.use(errorHandler);

// ─────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 IT Inventory API berjalan di http://localhost:${PORT}`);
  console.log(`📋 Dokumentasi endpoint: http://localhost:${PORT}/`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
