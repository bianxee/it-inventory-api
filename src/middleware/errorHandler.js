// src/middleware/errorHandler.js
// Centralized error handling middleware

const { ZodError } = require('zod');

/**
 * Format Zod validation errors menjadi pesan yang readable
 */
function formatZodErrors(error) {
  return error.errors.map((err) => ({
    field: err.path.join('.') || 'input',
    message: err.message,
  }));
}

/**
 * Middleware: error handler utama Express
 */
function errorHandler(err, req, res, next) {
  // ── Zod Validation Error ─────────────────────────────
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: 'Validasi input gagal',
      details: formatZodErrors(err),
    });
  }

  // ── Prisma Known Request Error ───────────────────────
  if (err.code) {
    switch (err.code) {
      case 'P2002': // Unique constraint violation
        return res.status(409).json({
          success: false,
          error: 'Data sudah ada',
          message: `Field ${err.meta?.target?.join(', ')} harus unik`,
        });
      case 'P2025': // Record not found
        return res.status(404).json({
          success: false,
          error: 'Data tidak ditemukan',
          message: err.meta?.cause || 'Record tidak ditemukan di database',
        });
      case 'P2003': // Foreign key constraint
        return res.status(400).json({
          success: false,
          error: 'Referensi data tidak valid',
          message: `Data relasi (${err.meta?.field_name}) tidak ditemukan`,
        });
      case 'P2014': // Required relation violation
        return res.status(400).json({
          success: false,
          error: 'Relasi data tidak valid',
        });
    }
  }

  // ── Custom Application Error ─────────────────────────
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
  }

  // ── Generic Server Error ─────────────────────────────
  console.error('❌ Unhandled Error:', err);
  return res.status(500).json({
    success: false,
    error: 'Terjadi kesalahan pada server',
    ...(process.env.NODE_ENV === 'development' && { debug: err.message }),
  });
}

/**
 * Helper: membuat custom error dengan status code
 */
function createError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Middleware: validasi request body dengan schema Zod
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      // Coerce angka dari JSON body
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Middleware: validasi query params dengan schema Zod
 */
function validateQuery(schema) {
  return (req, res, next) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { errorHandler, createError, validate, validateQuery };
