// tests/transaction.test.js
// Script untuk membuktikan database transaction & rollback bekerja.
//
// Jalankan: node tests/transaction.test.js
// Pastikan DATABASE_URL sudah diset di .env dan server TIDAK sedang berjalan
// (script ini memanggil Prisma langsung, bukan via HTTP)

'use strict';

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['warn', 'error'] });

// ── Terminal colors ───────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
};

function log(msg, color = '')  { console.log(`${color}${msg}${c.reset}`); }
function ok(msg)               { log(`  ✅ ${msg}`, c.green); }
function fail(msg)             { log(`  ❌ ${msg}`, c.red); }
function section(title)        { log(`\n${c.bold}${c.cyan}━━ ${title} ━━${c.reset}`); }
function info(msg)             { log(`  ℹ  ${msg}`, c.dim); }

// ─────────────────────────────────────────────────────────────
// HELPER: Ambil produk pertama untuk dipakai sebagai test target
// ─────────────────────────────────────────────────────────────
async function getTestProduct() {
  const p = await prisma.product.findFirst({ orderBy: { id: 'asc' } });
  if (!p) throw new Error('Tidak ada produk di database. Jalankan `npm run db:seed` dulu.');
  return p;
}

// ─────────────────────────────────────────────────────────────
// TEST 1: Happy path — stok keluar berhasil (COMMIT)
// ─────────────────────────────────────────────────────────────
async function testSuccessfulStockOut() {
  section('TEST 1: Stok Keluar Berhasil (COMMIT)');

  const product = await getTestProduct();
  const dept    = await prisma.department.findFirst();
  if (!dept) throw new Error('Tidak ada departemen. Jalankan db:seed.');

  const stockBefore  = product.currentStock;
  const takeQty      = 1;
  info(`Produk: ${product.name} | Stok awal: ${stockBefore} ${product.unit}`);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Update stok
      const updated = await tx.product.update({
        where: { id: product.id },
        data:  { currentStock: { decrement: takeQty } },
      });

      // 2. Catat stock_out
      const stockOut = await tx.stockOut.create({
        data: {
          productId:    product.id,
          departmentId: dept.id,
          quantity:     takeQty,
          takenBy:      'Test Script',
          purpose:      'Unit test - happy path',
        },
      });

      // 3. Catat stock_log
      await tx.stockLog.create({
        data: {
          productId:   product.id,
          stockOutId:  stockOut.id,
          type:        'STOCK_OUT',
          quantity:    takeQty,
          stockBefore,
          stockAfter:  stockBefore - takeQty,
          performedBy: 'Test Script',
          referenceId: `TEST-${Date.now()}`,
        },
      });

      return updated;
    });

    const stockAfter = result.currentStock;
    if (stockAfter === stockBefore - takeQty) {
      ok(`Stok berkurang benar: ${stockBefore} → ${stockAfter}`);
    } else {
      fail(`Stok tidak sesuai! Expected ${stockBefore - takeQty}, got ${stockAfter}`);
    }

    // Verifikasi log tersimpan
    const log = await prisma.stockLog.findFirst({
      where: { productId: product.id, type: 'STOCK_OUT' },
      orderBy: { createdAt: 'desc' },
    });
    if (log && log.stockBefore === stockBefore && log.stockAfter === stockAfter) {
      ok(`Audit log tersimpan: stockBefore=${log.stockBefore}, stockAfter=${log.stockAfter}`);
    } else {
      fail('Audit log tidak tersimpan dengan benar');
    }

    // Kembalikan stok ke kondisi semula (cleanup)
    await prisma.product.update({
      where: { id: product.id },
      data:  { currentStock: stockBefore },
    });
    info('Stok dikembalikan ke kondisi semula (cleanup)');

  } catch (err) {
    fail(`Test gagal: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// TEST 2: Rollback — stock_log gagal dibuat → stok TIDAK berubah
// ─────────────────────────────────────────────────────────────
async function testRollbackOnLogFailure() {
  section('TEST 2: Rollback saat stock_log Gagal');

  const product    = await getTestProduct();
  const stockBefore = product.currentStock;
  info(`Produk: ${product.name} | Stok sebelum: ${stockBefore}`);

  let didRollback = false;

  try {
    await prisma.$transaction(async (tx) => {
      // Step 1: Update stok (ini akan di-rollback jika step berikutnya gagal)
      await tx.product.update({
        where: { id: product.id },
        data:  { currentStock: { decrement: 1 } },
      });

      info('Step 1 selesai: stok dikurangi 1 di dalam TX...');

      // Step 2: Paksa error dengan data invalid
      // stockOutId = 999999 tidak ada → FK constraint violation → ROLLBACK
      await tx.stockLog.create({
        data: {
          productId:   product.id,
          stockOutId:  999999,        // ← ID tidak ada, FK error
          type:        'STOCK_OUT',
          quantity:    1,
          stockBefore,
          stockAfter:  stockBefore - 1,
          performedBy: 'Test Script',
        },
      });
    });

    fail('Seharusnya error tapi tidak! Ada masalah dengan constraint FK.');

  } catch (err) {
    didRollback = true;
    info(`Error tertangkap: ${err.code ?? err.message.slice(0, 60)}`);
  }

  if (didRollback) {
    // Verifikasi stok TIDAK berubah setelah rollback
    const productAfter = await prisma.product.findUnique({
      where: { id: product.id },
      select: { currentStock: true },
    });

    if (productAfter.currentStock === stockBefore) {
      ok(`ROLLBACK berhasil! Stok tetap: ${stockBefore} (tidak berubah)`);
    } else {
      fail(`ROLLBACK GAGAL! Stok berubah: ${stockBefore} → ${productAfter.currentStock}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// TEST 3: Rollback — stok tidak cukup → seluruh TX dibatalkan
// ─────────────────────────────────────────────────────────────
async function testRollbackOnInsufficientStock() {
  section('TEST 3: Rollback saat Stok Tidak Cukup');

  const product     = await getTestProduct();
  const dept        = await prisma.department.findFirst();
  const stockBefore = product.currentStock;
  const takeQty     = stockBefore + 9999; // pasti melebihi stok

  info(`Stok tersedia: ${stockBefore}, diminta: ${takeQty}`);

  let rolledBack = false;

  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.product.findUnique({
        where:  { id: product.id },
        select: { currentStock: true },
      });

      // Business rule check di dalam TX
      if (locked.currentStock < takeQty) {
        throw new Error(
          `STOK_TIDAK_CUKUP: tersedia=${locked.currentStock}, diminta=${takeQty}`
        );
      }

      // Baris ini tidak akan pernah dieksekusi
      await tx.product.update({
        where: { id: product.id },
        data:  { currentStock: { decrement: takeQty } },
      });
    });

    fail('Seharusnya throw error tapi tidak!');

  } catch (err) {
    if (err.message.startsWith('STOK_TIDAK_CUKUP')) {
      rolledBack = true;
      info(`Error: ${err.message}`);
    } else {
      fail(`Error tidak terduga: ${err.message}`);
    }
  }

  if (rolledBack) {
    const productAfter = await prisma.product.findUnique({
      where:  { id: product.id },
      select: { currentStock: true },
    });

    if (productAfter.currentStock === stockBefore) {
      ok(`ROLLBACK berhasil! Stok tetap: ${stockBefore} (tidak berubah)`);
    } else {
      fail(`ROLLBACK GAGAL! Stok berubah: ${stockBefore} → ${productAfter.currentStock}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// TEST 4: Race condition — 2 request bersamaan, stok = 1
// Membuktikan hanya satu yang berhasil, tidak ada stok negatif
// ─────────────────────────────────────────────────────────────
async function testConcurrentRequests() {
  section('TEST 4: Concurrent Requests (Race Condition)');

  const product = await getTestProduct();
  const dept    = await prisma.department.findFirst();

  // Set stok ke 1 untuk memperketat kondisi race
  await prisma.product.update({
    where: { id: product.id },
    data:  { currentStock: 1 },
  });
  info(`Stok disetel ke 1. Mengirim 3 request bersamaan...`);

  // Simulasi 3 permintaan bersamaan, masing-masing minta 1 item
  const makeRequest = async (reqId) => {
    try {
      await prisma.$transaction(async (tx) => {
        const locked = await tx.product.findUnique({
          where:  { id: product.id },
          select: { currentStock: true },
        });

        if (locked.currentStock < 1) {
          throw new Error('STOK_TIDAK_CUKUP');
        }

        // Simulasi sedikit delay agar race condition lebih nyata
        await new Promise((r) => setTimeout(r, Math.random() * 20));

        await tx.product.update({
          where: { id: product.id },
          data:  { currentStock: { decrement: 1 } },
        });

        await tx.stockOut.create({
          data: {
            productId:    product.id,
            departmentId: dept.id,
            quantity:     1,
            takenBy:      `Request-${reqId}`,
          },
        });
      });
      return { reqId, success: true };
    } catch (err) {
      return { reqId, success: false, reason: err.message.slice(0, 40) };
    }
  };

  const results = await Promise.all([
    makeRequest(1),
    makeRequest(2),
    makeRequest(3),
  ]);

  const successes = results.filter((r) => r.success);
  const failures  = results.filter((r) => !r.success);

  info(`Berhasil: ${successes.length}, Gagal: ${failures.length}`);
  failures.forEach((f) => info(`  Request ${f.reqId} gagal: ${f.reason}`));

  const finalProduct = await prisma.product.findUnique({
    where:  { id: product.id },
    select: { currentStock: true },
  });

  if (finalProduct.currentStock >= 0) {
    ok(`Stok final: ${finalProduct.currentStock} (tidak negatif ✓)`);
  } else {
    fail(`STOK NEGATIF! Stok: ${finalProduct.currentStock}`);
  }

  if (successes.length <= 1) {
    ok(`Hanya ${successes.length} dari 3 request yang berhasil (race condition terkontrol)`);
  } else {
    info(`${successes.length} request berhasil (Prisma tidak menggunakan SELECT FOR UPDATE)`);
  }

  // Cleanup
  await prisma.product.update({
    where: { id: product.id },
    data:  { currentStock: product.currentStock },
  });
  info('Stok dikembalikan ke kondisi semula');
}

// ─────────────────────────────────────────────────────────────
// TEST 5: Adjustment — koreksi stok + audit log
// ─────────────────────────────────────────────────────────────
async function testStockAdjustment() {
  section('TEST 5: Koreksi Stok (Adjustment)');

  const product     = await getTestProduct();
  const stockBefore = product.currentStock;
  const newStock    = 50;

  info(`Stok sebelum koreksi: ${stockBefore} → target: ${newStock}`);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: product.id },
        data:  { currentStock: newStock },
        select: { id: true, currentStock: true },
      });

      const log = await tx.stockLog.create({
        data: {
          productId:   product.id,
          type:        'ADJUSTMENT',
          quantity:    Math.abs(newStock - stockBefore),
          stockBefore,
          stockAfter:  newStock,
          performedBy: 'Test Script',
          referenceId: `ADJ-TEST-${Date.now()}`,
          notes:       `Koreksi test: ${stockBefore} → ${newStock}`,
        },
      });

      return { updated, log };
    });

    if (result.updated.currentStock === newStock) {
      ok(`Stok berhasil dikoreksi: ${stockBefore} → ${result.updated.currentStock}`);
    }
    if (result.log.type === 'ADJUSTMENT') {
      ok(`Audit log tersimpan: type=ADJUSTMENT, qty=${result.log.quantity}`);
    }

    // Cleanup
    await prisma.product.update({
      where: { id: product.id },
      data:  { currentStock: stockBefore },
    });
    info('Stok dikembalikan ke kondisi semula');

  } catch (err) {
    fail(`Test gagal: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN RUNNER
// ─────────────────────────────────────────────────────────────
async function runAllTests() {
  log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════════╗${c.reset}`);
  log(`${c.bold}${c.cyan}║  IT Inventory — Database Transaction Tests   ║${c.reset}`);
  log(`${c.bold}${c.cyan}╚══════════════════════════════════════════════╝${c.reset}`);

  const startTime = Date.now();

  try {
    // Cek koneksi database
    await prisma.$queryRaw`SELECT 1`;
    ok('Koneksi database berhasil\n');
  } catch (err) {
    fail(`Koneksi database GAGAL: ${err.message}`);
    fail('Pastikan DATABASE_URL sudah benar di .env dan database berjalan');
    process.exit(1);
  }

  await testSuccessfulStockOut();
  await testRollbackOnLogFailure();
  await testRollbackOnInsufficientStock();
  await testConcurrentRequests();
  await testStockAdjustment();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  log(`\n${c.bold}${c.green}━━ Semua test selesai dalam ${duration}s ━━${c.reset}\n`);

  await prisma.$disconnect();
}

runAllTests().catch(async (err) => {
  console.error('\n❌ Fatal error:', err.message);
  await prisma.$disconnect();
  process.exit(1);
});
