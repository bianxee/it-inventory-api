// src/validators/inventory.validator.js
// Validasi input menggunakan Zod

const { z } = require('zod');

// ─────────────────────────────────────────────────────────────
// STOCK IN: Validasi data barang masuk
// ─────────────────────────────────────────────────────────────
const stockInSchema = z.object({
  productId: z
    .number({ required_error: 'productId wajib diisi', invalid_type_error: 'productId harus berupa angka' })
    .int('productId harus bilangan bulat')
    .positive('productId harus lebih dari 0'),

  quantity: z
    .number({ required_error: 'quantity wajib diisi', invalid_type_error: 'quantity harus berupa angka' })
    .int('quantity harus bilangan bulat')
    .positive('quantity minimal 1')
    .max(10000, 'quantity tidak boleh melebihi 10.000'),

  receivedDate: z
    .string()
    .datetime({ message: 'Format tanggal tidak valid, gunakan ISO 8601 (contoh: 2024-01-15T00:00:00.000Z)' })
    .optional(),

  supplier: z
    .string()
    .min(2, 'Nama supplier minimal 2 karakter')
    .max(100, 'Nama supplier maksimal 100 karakter')
    .optional(),

  poNumber: z
    .string()
    .max(50, 'Nomor PO maksimal 50 karakter')
    .optional(),

  receivedBy: z
    .string({ required_error: 'receivedBy wajib diisi' })
    .min(2, 'Nama penerima minimal 2 karakter')
    .max(100, 'Nama penerima maksimal 100 karakter')
    .trim(),

  notes: z
    .string()
    .max(500, 'Catatan maksimal 500 karakter')
    .optional(),
});

// ─────────────────────────────────────────────────────────────
// STOCK OUT: Validasi data barang keluar
// ─────────────────────────────────────────────────────────────
const stockOutSchema = z.object({
  productId: z
    .number({ required_error: 'productId wajib diisi', invalid_type_error: 'productId harus berupa angka' })
    .int('productId harus bilangan bulat')
    .positive('productId harus lebih dari 0'),

  departmentId: z
    .number({ required_error: 'departmentId wajib diisi', invalid_type_error: 'departmentId harus berupa angka' })
    .int('departmentId harus bilangan bulat')
    .positive('departmentId harus lebih dari 0'),

  quantity: z
    .number({ required_error: 'quantity wajib diisi', invalid_type_error: 'quantity harus berupa angka' })
    .int('quantity harus bilangan bulat')
    .positive('quantity minimal 1')
    .max(10000, 'quantity tidak boleh melebihi 10.000'),

  takenDate: z
    .string()
    .datetime({ message: 'Format tanggal tidak valid, gunakan ISO 8601' })
    .optional(),

  takenBy: z
    .string({ required_error: 'takenBy wajib diisi' })
    .min(2, 'Nama pengambil minimal 2 karakter')
    .max(100, 'Nama pengambil maksimal 100 karakter')
    .trim(),

  purpose: z
    .string()
    .max(200, 'Keterangan keperluan maksimal 200 karakter')
    .optional(),

  notes: z
    .string()
    .max(500, 'Catatan maksimal 500 karakter')
    .optional(),
});

// ─────────────────────────────────────────────────────────────
// QUERY PARAMS: Validasi query string untuk GET /stok
// ─────────────────────────────────────────────────────────────
const stockQuerySchema = z.object({
  search: z.string().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  brandId: z.coerce.number().int().positive().optional(),
  printerModel: z.string().optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ─────────────────────────────────────────────────────────────
// STOCK ADJUSTMENT: Validasi koreksi manual stok
// ─────────────────────────────────────────────────────────────
const adjustmentSchema = z.object({
  productId: z
    .number({ required_error: 'productId wajib diisi', invalid_type_error: 'productId harus berupa angka' })
    .int('productId harus bilangan bulat')
    .positive('productId harus lebih dari 0'),

  newStock: z
    .number({ required_error: 'newStock wajib diisi', invalid_type_error: 'newStock harus berupa angka' })
    .int('newStock harus bilangan bulat')
    .min(0, 'newStock tidak boleh negatif')
    .max(100000, 'newStock tidak boleh melebihi 100.000'),

  reason: z
    .string()
    .max(500, 'Alasan koreksi maksimal 500 karakter')
    .optional(),

  performedBy: z
    .string({ required_error: 'performedBy wajib diisi' })
    .min(2, 'Nama pelaku minimal 2 karakter')
    .max(100, 'Nama pelaku maksimal 100 karakter')
    .trim(),
});

// ─────────────────────────────────────────────────────────────
// STOCK LOG QUERY: Validasi query untuk GET /stock-logs
// ─────────────────────────────────────────────────────────────
const stockLogQuerySchema = z.object({
  productId: z.coerce.number().int().positive().optional(),
  type:      z.enum(['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT']).optional(),
  page:      z.coerce.number().int().positive().default(1),
  limit:     z.coerce.number().int().positive().max(100).default(20),
});

module.exports = {
  stockInSchema,
  stockOutSchema,
  stockQuerySchema,
  adjustmentSchema,
  stockLogQuerySchema,
};
