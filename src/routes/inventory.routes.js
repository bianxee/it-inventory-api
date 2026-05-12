// src/routes/inventory.routes.js
// POST /stok-keluar & /stok-masuk kini menggunakan transactional controller

'use strict';

const express = require('express');
const router  = express.Router();

const prisma = require('../lib/prisma');
const { stockInSchema, stockOutSchema, stockQuerySchema } = require('../validators/inventory.validator');
const { validate, validateQuery, createError } = require('../middleware/errorHandler');
const {
  processStockOut,
  processStockIn,
  getStockLogs,
  adjustStock,
} = require('../controllers/stockTransaction.controller');

// ── GET /stok ────────────────────────────────────────────────
router.get('/stok', validateQuery(stockQuerySchema), async (req, res, next) => {
  try {
    const { search, categoryId, brandId, printerModel, page, limit } = req.query;
    const skip = (page - 1) * limit;

    const where = {
      AND: [
        search ? {
          OR: [
            { name:         { contains: search, mode: 'insensitive' } },
            { sku:          { contains: search, mode: 'insensitive' } },
            { printerModel: { name: { contains: search, mode: 'insensitive' } } },
          ],
        } : {},
        categoryId   ? { categoryId:   Number(categoryId) }   : {},
        brandId      ? { brandId:      Number(brandId) }      : {},
        printerModel ? { printerModel: { name: { contains: printerModel, mode: 'insensitive' } } } : {},
      ],
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          category:     { select: { id: true, name: true } },
          brand:        { select: { id: true, name: true } },
          printerModel: { select: { id: true, name: true, type: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      success: true,
      data: products.map((p) => ({
        ...p,
        stockStatus: p.currentStock === 0 ? 'habis' : p.currentStock <= p.minStock ? 'menipis' : 'tersedia',
        isLowStock:  p.currentStock <= p.minStock,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

// ── GET /stok/:id ────────────────────────────────────────────
router.get('/stok/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw createError(400, 'ID tidak valid');

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true, brand: true, printerModel: true,
        stockIns:  { orderBy: { createdAt: 'desc' }, take: 10 },
        stockOuts: {
          orderBy: { createdAt: 'desc' }, take: 10,
          include: { department: { select: { id: true, name: true, code: true } } },
        },
      },
    });

    if (!product) throw createError(404, `Produk ID ${id} tidak ditemukan`);
    res.json({ success: true, data: { ...product, isLowStock: product.currentStock <= product.minStock } });
  } catch (err) { next(err); }
});

// ── POST /stok-keluar  ← TRANSACTIONAL ──────────────────────
router.post('/stok-keluar', validate(stockOutSchema), processStockOut);

// ── POST /stok-masuk   ← TRANSACTIONAL ──────────────────────
router.post('/stok-masuk', validate(stockInSchema), processStockIn);

// ── POST /stok-adjustment  ← koreksi manual ─────────────────
router.post('/stok-adjustment', async (req, res, next) => {
  const { z } = require('zod');
  const schema = z.object({
    productId:   z.number().int().positive(),
    newStock:    z.number().int().min(0, 'newStock tidak boleh negatif'),
    reason:      z.string().optional(),
    performedBy: z.string().min(2, 'performedBy minimal 2 karakter').trim(),
  });
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (err) { next(err); }
}, adjustStock);

// ── GET /stock-logs  ← audit trail ──────────────────────────
router.get('/stock-logs', getStockLogs);

// ── GET /alert ───────────────────────────────────────────────
router.get('/alert', async (req, res, next) => {
  try {
    const threshold = req.query.threshold ? parseInt(req.query.threshold) : null;

    const items = await prisma.product.findMany({
      where: threshold !== null
        ? { currentStock: { lte: threshold } }
        : { currentStock: { lte: 3 } },
      orderBy: [{ currentStock: 'asc' }, { name: 'asc' }],
      include: {
        category:     { select: { name: true } },
        brand:        { select: { name: true } },
        printerModel: { select: { name: true } },
      },
    });

    const fmt = (p) => ({
      id: p.id, nama: p.name, sku: p.sku,
      kategori: p.category.name, brand: p.brand.name,
      printerModel: p.printerModel?.name ?? '-',
      stokSaat: p.currentStock, stokMinimum: p.minStock,
      unit: p.unit, kekurangan: Math.max(0, p.minStock - p.currentStock),
      status: p.currentStock === 0 ? 'HABIS' : 'MENIPIS',
    });

    res.json({
      success:  true,
      ringkasan: {
        totalAlert:  items.length,
        itemHabis:   items.filter((p) => p.currentStock === 0).length,
        itemMenipis: items.filter((p) => p.currentStock > 0).length,
        generatedAt: new Date().toISOString(),
      },
      data: {
        kritis:  items.filter((p) => p.currentStock === 0).map(fmt),
        menipis: items.filter((p) => p.currentStock > 0).map(fmt),
      },
    });
  } catch (err) { next(err); }
});

// ── GET /riwayat ─────────────────────────────────────────────
router.get('/riwayat', async (req, res, next) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;
    const type  = req.query.type;

    const [ins, outs] = await Promise.all([
      type !== 'keluar' ? prisma.stockIn.findMany({
        orderBy: { createdAt: 'desc' },
        include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
      }) : [],
      type !== 'masuk' ? prisma.stockOut.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          product:    { select: { id: true, name: true, sku: true, unit: true } },
          department: { select: { id: true, name: true, code: true } },
        },
      }) : [],
    ]);

    const combined = [
      ...ins.map((s)  => ({ ...s, jenis: 'MASUK',  pihak: s.supplier        ?? '-' })),
      ...outs.map((s) => ({ ...s, jenis: 'KELUAR', pihak: s.department?.name ?? '-' })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      data:    combined.slice(skip, skip + limit),
      meta:    { total: combined.length, page, limit, totalPages: Math.ceil(combined.length / limit) },
    });
  } catch (err) { next(err); }
});

module.exports = router;
