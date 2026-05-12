// src/controllers/stockTransaction.controller.js
//
// Controller dengan DATABASE TRANSACTION penuh.
//
// Prinsip:
//   Setiap operasi stok (keluar / masuk) harus:
//   1. Baca stok saat ini  (SELECT ... FOR UPDATE)
//   2. Validasi bisnis     (stok cukup?)
//   3. Kurangi/tambah stok (UPDATE products)
//   4. Catat transaksi     (INSERT stock_out / stock_in)
//   5. Tulis audit log     (INSERT stock_logs)
//
//   Semua langkah 3-5 berjalan dalam SATU transaksi Prisma.
//   Jika langkah 4 atau 5 gagal → seluruhnya di-ROLLBACK otomatis.

'use strict';

const prisma       = require('../lib/prisma');
const { createError } = require('../middleware/errorHandler');

// ─────────────────────────────────────────────────────────────
// HELPER: Hitung status stok
// ─────────────────────────────────────────────────────────────
function stockStatus(current, min) {
  if (current === 0)       return 'habis';
  if (current <= min)      return 'menipis';
  return 'tersedia';
}

// ─────────────────────────────────────────────────────────────
// HELPER: Format peringatan
// ─────────────────────────────────────────────────────────────
function buildWarning(product) {
  const { name, currentStock, minStock, unit } = product;
  if (currentStock === 0) {
    return { level: 'KRITIS', message: `⚠️ Stok "${name}" telah HABIS! Segera lakukan pengadaan.` };
  }
  if (currentStock <= minStock) {
    return { level: 'RENDAH', message: `⚠️ Stok "${name}" menipis (${currentStock} ${unit}). Pertimbangkan pengadaan segera.` };
  }
  return null;
}

// ═════════════════════════════════════════════════════════════
// CONTROLLER: processStockOut
//
// POST /api/v1/stok-keluar
//
// Flow:
//   TX_START
//     1. Lock row product (findUnique inside tx)
//     2. Validasi stok mencukupi
//     3. UPDATE products SET current_stock -= quantity  (decrement)
//     4. INSERT stock_out (transaksi)
//     5. INSERT stock_logs (audit trail)
//   TX_COMMIT  ← semua berhasil
//   TX_ROLLBACK← salah satu gagal → data kembali seperti semula
// ═════════════════════════════════════════════════════════════
async function processStockOut(req, res, next) {
  const {
    productId,
    departmentId,
    quantity,
    takenDate,
    takenBy,
    purpose,
    notes,
  } = req.body;

  try {
    // ── Pra-validasi di luar transaksi (hemat round-trip) ──
    const [product, department] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId } }),
      prisma.department.findUnique({ where: { id: departmentId } }),
    ]);

    if (!product)    throw createError(404, `Produk ID ${productId} tidak ditemukan`);
    if (!department) throw createError(404, `Departemen ID ${departmentId} tidak ditemukan`);

    if (product.currentStock === 0) {
      throw createError(400,
        `Stok "${product.name}" sudah HABIS. Pengambilan tidak dapat dilakukan.`
      );
    }
    if (product.currentStock < quantity) {
      throw createError(400,
        `Stok "${product.name}" tidak mencukupi. ` +
        `Tersedia: ${product.currentStock} ${product.unit}, diminta: ${quantity} ${product.unit}.`
      );
    }

    // ─────────────────────────────────────────────────────
    // DATABASE TRANSACTION
    // Prisma.$transaction menjamin atomicity:
    //   - Jika SALAH SATU operasi gagal (throw / DB error)
    //     → semua operasi dalam blok ini di-ROLLBACK
    //   - Jika SEMUA berhasil → COMMIT
    // ─────────────────────────────────────────────────────
    const result = await prisma.$transaction(async (tx) => {

      // STEP 1 ── Re-read product di dalam TX (row-level lock)
      // Ini mencegah race condition jika ada 2 request bersamaan.
      const lockedProduct = await tx.product.findUnique({
        where: { id: productId },
        select: {
          id: true, name: true, sku: true,
          currentStock: true, minStock: true, unit: true,
        },
      });

      // Validasi ulang di dalam TX (data mungkin sudah berubah)
      if (lockedProduct.currentStock < quantity) {
        throw new Error(
          `STOK_TIDAK_CUKUP: stok terkini ${lockedProduct.currentStock}, diminta ${quantity}`
        );
      }

      const stockBefore = lockedProduct.currentStock;
      const stockAfter  = stockBefore - quantity;

      // STEP 2 ── UPDATE products.current_stock (decrement)
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data:  { currentStock: { decrement: quantity } },
        select: {
          id: true, name: true, sku: true,
          currentStock: true, minStock: true, unit: true,
          updatedAt: true,
        },
      });

      // Sanity check — stok tidak boleh negatif
      if (updatedProduct.currentStock < 0) {
        throw new Error('STOK_NEGATIF: hasil pengurangan menghasilkan stok negatif');
      }

      // STEP 3 ── INSERT stock_out (catat transaksi)
      const stockOut = await tx.stockOut.create({
        data: {
          productId,
          departmentId,
          quantity,
          takenDate:  takenDate ? new Date(takenDate) : new Date(),
          takenBy,
          purpose:    purpose ?? null,
          notes:      notes   ?? null,
        },
        include: {
          product:    { select: { id: true, name: true, sku: true, unit: true } },
          department: { select: { id: true, name: true, code: true } },
        },
      });

      // STEP 4 ── INSERT stock_logs (audit trail)
      // Ini adalah baris yang "harus berhasil bersama" dengan step 2 & 3.
      // Jika INSERT ini gagal → ROLLBACK step 2 & 3 otomatis.
      const stockLog = await tx.stockLog.create({
        data: {
          productId,
          stockOutId:  stockOut.id,
          type:        'STOCK_OUT',
          quantity,
          stockBefore,
          stockAfter,
          performedBy: takenBy,
          referenceId: `SOUT-${stockOut.id}`,
          notes:       purpose
            ? `Pengambilan oleh ${takenBy} (${department.name}): ${purpose}`
            : `Pengambilan oleh ${takenBy} (${department.name})`,
        },
      });

      return { stockOut, stockLog, updatedProduct, stockBefore, stockAfter };
    }); // ← TX COMMIT di sini jika tidak ada error

    // ── Build response ──────────────────────────────────
    const { stockOut, stockLog, updatedProduct, stockBefore, stockAfter } = result;
    const peringatan = buildWarning(updatedProduct);

    return res.status(201).json({
      success: true,
      message: `Stok keluar berhasil dicatat. ${quantity} ${updatedProduct.unit} diambil oleh ${department.name}.`,
      data: {
        transaksi: {
          id:           stockOut.id,
          productId:    stockOut.productId,
          departmentId: stockOut.departmentId,
          quantity:     stockOut.quantity,
          takenDate:    stockOut.takenDate,
          takenBy:      stockOut.takenBy,
          purpose:      stockOut.purpose,
          product:      stockOut.product,
          department:   stockOut.department,
        },
        stokUpdate: {
          id:           updatedProduct.id,
          name:         updatedProduct.name,
          sku:          updatedProduct.sku,
          currentStock: updatedProduct.currentStock,
          minStock:     updatedProduct.minStock,
          unit:         updatedProduct.unit,
          stokSebelum:  stockBefore,
          stokSesudah:  stockAfter,
          selisih:      `-${quantity}`,
          stockStatus:  stockStatus(updatedProduct.currentStock, updatedProduct.minStock),
          updatedAt:    updatedProduct.updatedAt,
        },
        auditLog: {
          id:          stockLog.id,
          type:        stockLog.type,
          stockBefore: stockLog.stockBefore,
          stockAfter:  stockLog.stockAfter,
          createdAt:   stockLog.createdAt,
        },
      },
      ...(peringatan && { peringatan }),
    });

  } catch (err) {
    // Tangani error STOK_TIDAK_CUKUP yang dilempar dari dalam TX
    if (err.message?.startsWith('STOK_TIDAK_CUKUP')) {
      return next(createError(409,
        'Stok berubah saat proses berlangsung. Silakan coba lagi.'
      ));
    }
    if (err.message?.startsWith('STOK_NEGATIF')) {
      return next(createError(500, 'Kesalahan integritas data: stok tidak boleh negatif.'));
    }
    next(err);
  }
}

// ═════════════════════════════════════════════════════════════
// CONTROLLER: processStockIn
//
// POST /api/v1/stok-masuk
//
// Flow mirip dengan processStockOut, namun:
//   3. UPDATE products SET current_stock += quantity  (increment)
//   4. INSERT stock_in
//   5. INSERT stock_logs (type: STOCK_IN)
// ═════════════════════════════════════════════════════════════
async function processStockIn(req, res, next) {
  const {
    productId,
    quantity,
    receivedDate,
    supplier,
    poNumber,
    receivedBy,
    notes,
  } = req.body;

  try {
    // Pra-validasi
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw createError(404, `Produk ID ${productId} tidak ditemukan`);

    // ─────────────────────────────────────────────────────
    // DATABASE TRANSACTION
    // ─────────────────────────────────────────────────────
    const result = await prisma.$transaction(async (tx) => {

      // STEP 1 ── Baca stok saat ini di dalam TX
      const lockedProduct = await tx.product.findUnique({
        where:  { id: productId },
        select: { id: true, currentStock: true, minStock: true, unit: true, name: true },
      });

      const stockBefore = lockedProduct.currentStock;
      const stockAfter  = stockBefore + quantity;

      // STEP 2 ── UPDATE products.current_stock (increment)
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data:  { currentStock: { increment: quantity } },
        select: {
          id: true, name: true, sku: true,
          currentStock: true, minStock: true, unit: true,
          updatedAt: true,
        },
      });

      // STEP 3 ── INSERT stock_in
      const stockIn = await tx.stockIn.create({
        data: {
          productId,
          quantity,
          receivedDate: receivedDate ? new Date(receivedDate) : new Date(),
          supplier:     supplier  ?? null,
          poNumber:     poNumber  ?? null,
          receivedBy,
          notes:        notes     ?? null,
        },
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
        },
      });

      // STEP 4 ── INSERT stock_logs
      const stockLog = await tx.stockLog.create({
        data: {
          productId,
          stockInId:   stockIn.id,
          type:        'STOCK_IN',
          quantity,
          stockBefore,
          stockAfter,
          performedBy: receivedBy,
          referenceId: poNumber ? `PO-${poNumber}` : `SIN-${stockIn.id}`,
          notes: supplier
            ? `Penerimaan dari ${supplier} oleh ${receivedBy}`
            : `Penerimaan oleh ${receivedBy}`,
        },
      });

      return { stockIn, stockLog, updatedProduct, stockBefore, stockAfter };
    }); // ← TX COMMIT

    const { stockIn, stockLog, updatedProduct, stockBefore, stockAfter } = result;

    return res.status(201).json({
      success: true,
      message: `Stok masuk berhasil dicatat. ${quantity} ${updatedProduct.unit} ditambahkan ke "${updatedProduct.name}".`,
      data: {
        transaksi: {
          id:           stockIn.id,
          productId:    stockIn.productId,
          quantity:     stockIn.quantity,
          receivedDate: stockIn.receivedDate,
          supplier:     stockIn.supplier,
          poNumber:     stockIn.poNumber,
          receivedBy:   stockIn.receivedBy,
          product:      stockIn.product,
        },
        stokUpdate: {
          id:           updatedProduct.id,
          name:         updatedProduct.name,
          sku:          updatedProduct.sku,
          currentStock: updatedProduct.currentStock,
          minStock:     updatedProduct.minStock,
          unit:         updatedProduct.unit,
          stokSebelum:  stockBefore,
          stokSesudah:  stockAfter,
          selisih:      `+${quantity}`,
          stockStatus:  stockStatus(updatedProduct.currentStock, updatedProduct.minStock),
          updatedAt:    updatedProduct.updatedAt,
        },
        auditLog: {
          id:          stockLog.id,
          type:        stockLog.type,
          stockBefore: stockLog.stockBefore,
          stockAfter:  stockLog.stockAfter,
          createdAt:   stockLog.createdAt,
        },
      },
    });

  } catch (err) {
    next(err);
  }
}

// ═════════════════════════════════════════════════════════════
// CONTROLLER: getStockLogs
//
// GET /api/v1/stock-logs?productId=&type=&page=&limit=
// Mengambil audit trail perubahan stok
// ═════════════════════════════════════════════════════════════
async function getStockLogs(req, res, next) {
  try {
    const page      = parseInt(req.query.page)      || 1;
    const limit     = parseInt(req.query.limit)     || 20;
    const productId = req.query.productId ? parseInt(req.query.productId) : undefined;
    const type      = req.query.type; // 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT'
    const skip      = (page - 1) * limit;

    const where = {
      ...(productId && { productId }),
      ...(type      && { type }),
    };

    const [logs, total] = await Promise.all([
      prisma.stockLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
          stockOut: {
            select: {
              id: true, takenBy: true, purpose: true,
              department: { select: { id: true, name: true, code: true } },
            },
          },
          stockIn: {
            select: { id: true, receivedBy: true, supplier: true, poNumber: true },
          },
        },
      }),
      prisma.stockLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: logs,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ═════════════════════════════════════════════════════════════
// CONTROLLER: adjustStock  (koreksi manual stok)
//
// POST /api/v1/stok-adjustment
// Body: { productId, newStock, reason, performedBy }
// ═════════════════════════════════════════════════════════════
async function adjustStock(req, res, next) {
  const { productId, newStock, reason, performedBy } = req.body;

  if (newStock === undefined || newStock < 0) {
    return next(createError(400, 'newStock wajib diisi dan tidak boleh negatif'));
  }
  if (!performedBy?.trim()) {
    return next(createError(400, 'performedBy wajib diisi'));
  }

  try {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw createError(404, `Produk ID ${productId} tidak ditemukan`);

    const result = await prisma.$transaction(async (tx) => {
      const lockedProduct = await tx.product.findUnique({
        where:  { id: productId },
        select: { id: true, currentStock: true, name: true, sku: true, unit: true, minStock: true },
      });

      const stockBefore = lockedProduct.currentStock;
      const stockAfter  = newStock;
      const diff        = stockAfter - stockBefore;

      // UPDATE stok ke nilai baru
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data:  { currentStock: newStock },
        select: {
          id: true, name: true, sku: true,
          currentStock: true, minStock: true, unit: true, updatedAt: true,
        },
      });

      // INSERT audit log koreksi
      const stockLog = await tx.stockLog.create({
        data: {
          productId,
          type:        'ADJUSTMENT',
          quantity:    Math.abs(diff),
          stockBefore,
          stockAfter,
          performedBy,
          referenceId: `ADJ-${Date.now()}`,
          notes:       reason
            ? `Koreksi manual oleh ${performedBy}: ${reason}`
            : `Koreksi manual oleh ${performedBy}`,
        },
      });

      return { updatedProduct, stockLog, stockBefore, stockAfter, diff };
    });

    const { updatedProduct, stockLog, stockBefore, stockAfter, diff } = result;

    return res.json({
      success: true,
      message: `Stok "${updatedProduct.name}" berhasil dikoreksi: ${stockBefore} → ${stockAfter} ${updatedProduct.unit}.`,
      data: {
        produk: updatedProduct,
        auditLog: {
          id:          stockLog.id,
          type:        'ADJUSTMENT',
          stockBefore,
          stockAfter,
          selisih:     diff >= 0 ? `+${diff}` : `${diff}`,
          performedBy,
          createdAt:   stockLog.createdAt,
        },
      },
    });

  } catch (err) {
    next(err);
  }
}

module.exports = { processStockOut, processStockIn, getStockLogs, adjustStock };
