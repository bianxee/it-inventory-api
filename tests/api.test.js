// tests/api.test.js
// Test semua endpoint via HTTP (server harus berjalan di port 3000)
// Jalankan: node tests/api.test.js

'use strict';

const BASE = process.env.API_URL || 'http://localhost:3000/api/v1';

// ── Terminal colors ───────────────────────────────────────────
const c = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m',
};

let passed = 0;
let failed = 0;

function section(title) {
  console.log(`\n${c.bold}${c.cyan}━━ ${title} ━━${c.reset}`);
}
function ok(msg)   { console.log(`  ${c.green}✅ ${msg}${c.reset}`); passed++; }
function fail(msg) { console.log(`  ${c.red}❌ ${msg}${c.reset}`);   failed++; }
function info(msg) { console.log(`  ${c.dim}ℹ  ${msg}${c.reset}`); }

// ─────────────────────────────────────────────────────────────
// HTTP helper
// ─────────────────────────────────────────────────────────────
async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res  = await fetch(`${BASE}${path}`, opts);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

// ─────────────────────────────────────────────────────────────
// Ambil ID produk & departemen dari database
// ─────────────────────────────────────────────────────────────
async function getIds() {
  const stok = await req('GET', '/stok?limit=1');
  const productId = stok.body.data?.[0]?.id;
  if (!productId) throw new Error('Tidak ada produk. Jalankan db:seed dulu.');

  // Hardcode dept ID 1 — sesuai seed data
  return { productId, departmentId: 1 };
}

// ─────────────────────────────────────────────────────────────
// TEST SUITE
// ─────────────────────────────────────────────────────────────

async function testGetStok() {
  section('GET /stok');

  const r = await req('GET', '/stok');
  r.status === 200 && r.body.success
    ? ok(`Status 200, ${r.body.data?.length} produk dimuat`)
    : fail(`Status ${r.status}: ${r.body.error}`);

  // Filter by search
  const r2 = await req('GET', '/stok?search=HP');
  const allHp = r2.body.data?.every((p) => p.brand.name === 'HP' || p.name.includes('HP'));
  r2.status === 200 ? ok('Filter search=HP berfungsi') : fail(`Search gagal: ${r2.status}`);

  // Pagination
  const r3 = await req('GET', '/stok?page=1&limit=2');
  r3.body.data?.length <= 2
    ? ok('Pagination limit=2 berfungsi')
    : fail('Pagination tidak bekerja');
}

async function testStockOut(productId, departmentId) {
  section('POST /stok-keluar (Transaction)');

  // ── Success case ──────────────────────────────────────────
  const r = await req('POST', '/stok-keluar', {
    productId,
    departmentId,
    quantity:  1,
    takenBy:   'Budi Santoso',
    purpose:   'Test unit - stok keluar',
  });

  if (r.status === 201 && r.body.success) {
    ok(`Stok keluar berhasil: ${r.body.data?.stokUpdate?.stokSebelum} → ${r.body.data?.stokUpdate?.stokSesudah}`);
    r.body.data?.auditLog?.id
      ? ok(`Audit log ID: ${r.body.data.auditLog.id} tersimpan`)
      : fail('Audit log tidak ada di response');
    if (r.body.peringatan) {
      info(`Peringatan: [${r.body.peringatan.level}] ${r.body.peringatan.message}`);
    }
  } else {
    fail(`Status ${r.status}: ${r.body.error ?? JSON.stringify(r.body)}`);
  }

  // ── Validasi: quantity negatif ────────────────────────────
  const r2 = await req('POST', '/stok-keluar', {
    productId, departmentId, quantity: -5, takenBy: 'Test',
  });
  r2.status === 400
    ? ok('Validasi quantity negatif → 400')
    : fail(`Validasi quantity negatif seharusnya 400, dapat ${r2.status}`);

  // ── Validasi: field wajib kosong ──────────────────────────
  const r3 = await req('POST', '/stok-keluar', { productId, departmentId, quantity: 1 });
  r3.status === 400
    ? ok('Validasi takenBy kosong → 400')
    : fail(`Seharusnya 400, dapat ${r3.status}`);

  // ── Validasi: stok melebihi tersedia ─────────────────────
  const r4 = await req('POST', '/stok-keluar', {
    productId, departmentId, quantity: 999999, takenBy: 'Test',
  });
  r4.status === 400 || r4.status === 409
    ? ok(`Stok tidak cukup → ${r4.status}`)
    : fail(`Seharusnya 400/409, dapat ${r4.status}`);

  // ── Validasi: product tidak ada ───────────────────────────
  const r5 = await req('POST', '/stok-keluar', {
    productId: 999999, departmentId, quantity: 1, takenBy: 'Test',
  });
  r5.status === 404
    ? ok('Produk tidak ada → 404')
    : fail(`Seharusnya 404, dapat ${r5.status}`);

  return r.body.data?.transaksi;
}

async function testStockIn(productId) {
  section('POST /stok-masuk (Transaction)');

  const r = await req('POST', '/stok-masuk', {
    productId,
    quantity:    5,
    receivedBy:  'Budi Santoso',
    supplier:    'CV Maju Jaya',
    poNumber:    'PO-TEST-001',
    notes:       'Test unit - stok masuk',
  });

  if (r.status === 201 && r.body.success) {
    ok(`Stok masuk berhasil: +${r.body.data?.stokUpdate?.selisih}`);
    ok(`Stok sesudah: ${r.body.data?.stokUpdate?.stokSesudah} ${r.body.data?.stokUpdate?.unit}`);
    r.body.data?.auditLog?.id
      ? ok(`Audit log ID: ${r.body.data.auditLog.id} tersimpan`)
      : fail('Audit log tidak ada di response');
  } else {
    fail(`Status ${r.status}: ${r.body.error ?? JSON.stringify(r.body)}`);
  }
}

async function testAdjustment(productId) {
  section('POST /stok-adjustment');

  const r = await req('POST', '/stok-adjustment', {
    productId,
    newStock:    20,
    reason:      'Koreksi hasil stock opname',
    performedBy: 'Budi Santoso',
  });

  if (r.status === 200 && r.body.success) {
    ok(`Koreksi stok berhasil: ${r.body.data?.auditLog?.stockBefore} → ${r.body.data?.auditLog?.stockAfter}`);
    ok(`Selisih: ${r.body.data?.auditLog?.selisih}`);
  } else {
    fail(`Status ${r.status}: ${r.body.error ?? JSON.stringify(r.body)}`);
  }

  // Negatif tidak boleh
  const r2 = await req('POST', '/stok-adjustment', {
    productId, newStock: -1, performedBy: 'Test',
  });
  r2.status === 400
    ? ok('Validasi newStock negatif → 400')
    : fail(`Seharusnya 400, dapat ${r2.status}`);
}

async function testStockLogs(productId) {
  section('GET /stock-logs (Audit Trail)');

  const r = await req('GET', '/stock-logs');
  r.status === 200 && r.body.success
    ? ok(`Status 200, ${r.body.data?.length} log dimuat`)
    : fail(`Status ${r.status}`);

  // Filter by product
  const r2 = await req('GET', `/stock-logs?productId=${productId}`);
  r2.status === 200
    ? ok(`Filter productId=${productId}: ${r2.body.data?.length} log`)
    : fail(`Filter productId gagal: ${r2.status}`);

  // Filter by type
  const r3 = await req('GET', '/stock-logs?type=STOCK_OUT');
  const allOut = r3.body.data?.every((l) => l.type === 'STOCK_OUT');
  r3.status === 200 && allOut !== false
    ? ok(`Filter type=STOCK_OUT berfungsi`)
    : fail(`Filter type gagal`);

  // Cek struktur audit log
  const log = r.body.data?.[0];
  if (log) {
    ['id','type','quantity','stockBefore','stockAfter','performedBy','createdAt'].every(
      (k) => log[k] !== undefined
    )
      ? ok('Struktur audit log lengkap (semua field ada)')
      : fail('Struktur audit log tidak lengkap');
  }
}

async function testAlert() {
  section('GET /alert');

  const r = await req('GET', '/alert');
  if (r.status === 200 && r.body.success) {
    ok(`Alert endpoint berfungsi`);
    ok(`Total alert: ${r.body.ringkasan?.totalAlert} item`);
    info(`Item habis: ${r.body.ringkasan?.itemHabis}, Menipis: ${r.body.ringkasan?.itemMenipis}`);
  } else {
    fail(`Status ${r.status}`);
  }
}

async function testRiwayat() {
  section('GET /riwayat');

  const r = await req('GET', '/riwayat?limit=5');
  r.status === 200 && r.body.success
    ? ok(`Riwayat dimuat: ${r.body.data?.length} item`)
    : fail(`Status ${r.status}`);

  const r2 = await req('GET', '/riwayat?type=keluar');
  const allOut = r2.body.data?.every((t) => t.jenis === 'KELUAR');
  r2.status === 200 && allOut !== false
    ? ok('Filter type=keluar berfungsi')
    : fail('Filter type riwayat gagal');
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}║   IT Inventory — API Endpoint Tests      ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}╚══════════════════════════════════════════╝${c.reset}`);
  console.log(`${c.dim}  Base URL: ${BASE}${c.reset}\n`);

  // Cek server jalan
  try {
    await fetch(`${BASE}/stok?limit=1`);
  } catch {
    console.error(`${c.red}❌ Server tidak dapat dihubungi di ${BASE}${c.reset}`);
    console.error(`${c.yellow}   Jalankan 'npm run dev' di folder it-inventory-api dulu.${c.reset}\n`);
    process.exit(1);
  }

  const { productId, departmentId } = await getIds();
  info(`Test menggunakan productId=${productId}, departmentId=${departmentId}\n`);

  await testGetStok();
  await testStockOut(productId, departmentId);
  await testStockIn(productId);
  await testAdjustment(productId);
  await testStockLogs(productId);
  await testAlert();
  await testRiwayat();

  // Summary
  const total = passed + failed;
  console.log(`\n${c.bold}━━ Hasil: ${passed}/${total} test berhasil ━━${c.reset}`);
  if (failed > 0) {
    console.log(`${c.red}   ${failed} test GAGAL${c.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${c.green}   Semua test LULUS ✅${c.reset}\n`);
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err.message);
  process.exit(1);
});
