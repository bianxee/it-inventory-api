// prisma/seed.js
// Data awal untuk testing & development

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database IT Inventory...');

  // ── Categories ──────────────────────────────────────
  const categories = await Promise.all([
    prisma.category.upsert({ where: { name: 'Cartridge' }, update: {}, create: { name: 'Cartridge', description: 'Cartridge tinta untuk printer inkjet' } }),
    prisma.category.upsert({ where: { name: 'Toner' }, update: {}, create: { name: 'Toner', description: 'Toner powder untuk printer laser' } }),
    prisma.category.upsert({ where: { name: 'Tinta Botol' }, update: {}, create: { name: 'Tinta Botol', description: 'Tinta isi ulang dalam botol (EcoTank/InkTank)' } }),
  ]);

  // ── Brands ──────────────────────────────────────────
  const brands = await Promise.all([
    prisma.brand.upsert({ where: { name: 'HP' }, update: {}, create: { name: 'HP', description: 'Hewlett-Packard' } }),
    prisma.brand.upsert({ where: { name: 'Canon' }, update: {}, create: { name: 'Canon' } }),
    prisma.brand.upsert({ where: { name: 'Epson' }, update: {}, create: { name: 'Epson' } }),
    prisma.brand.upsert({ where: { name: 'Brother' }, update: {}, create: { name: 'Brother' } }),
  ]);

  // ── Printer Models ───────────────────────────────────
  const printers = await Promise.all([
    prisma.printerModel.upsert({ where: { name: 'HP LaserJet Pro M404dn' }, update: {}, create: { name: 'HP LaserJet Pro M404dn', type: 'Laser' } }),
    prisma.printerModel.upsert({ where: { name: 'Canon PIXMA G2010' }, update: {}, create: { name: 'Canon PIXMA G2010', type: 'Inkjet' } }),
    prisma.printerModel.upsert({ where: { name: 'Epson L3210' }, update: {}, create: { name: 'Epson L3210', type: 'Inkjet' } }),
    prisma.printerModel.upsert({ where: { name: 'Brother DCP-L2540DW' }, update: {}, create: { name: 'Brother DCP-L2540DW', type: 'Laser' } }),
  ]);

  // ── Departments ──────────────────────────────────────
  await Promise.all([
    prisma.department.upsert({ where: { code: 'IT-001' }, update: {}, create: { name: 'Information Technology', code: 'IT-001', picName: 'Budi Santoso' } }),
    prisma.department.upsert({ where: { code: 'FIN-001' }, update: {}, create: { name: 'Finance & Accounting', code: 'FIN-001', picName: 'Sari Dewi' } }),
    prisma.department.upsert({ where: { code: 'HR-001' }, update: {}, create: { name: 'Human Resources', code: 'HR-001', picName: 'Andi Pratama' } }),
    prisma.department.upsert({ where: { code: 'OPS-001' }, update: {}, create: { name: 'Operations', code: 'OPS-001', picName: 'Rini Utami' } }),
    prisma.department.upsert({ where: { code: 'MKT-001' }, update: {}, create: { name: 'Marketing', code: 'MKT-001', picName: 'Doni Kurniawan' } }),
  ]);

  // ── Products ─────────────────────────────────────────
  await Promise.all([
    prisma.product.upsert({
      where: { sku: 'HP-CF217A' },
      update: {},
      create: {
        name: 'HP 17A Black LaserJet Toner',
        sku: 'HP-CF217A',
        categoryId: categories[1].id, // Toner
        brandId: brands[0].id,        // HP
        printerModelId: printers[0].id,
        color: 'Black', currentStock: 8, minStock: 3, unit: 'pcs',
        description: 'Toner HP Original untuk LaserJet Pro M102/M130',
      }
    }),
    prisma.product.upsert({
      where: { sku: 'HP-678-BK' },
      update: {},
      create: {
        name: 'HP 678 Black Cartridge',
        sku: 'HP-678-BK',
        categoryId: categories[0].id, // Cartridge
        brandId: brands[0].id,
        color: 'Black', currentStock: 2, minStock: 3, unit: 'pcs',
        description: 'HP 678 Ink Cartridge Black',
      }
    }),
    prisma.product.upsert({
      where: { sku: 'EPS-664-BK' },
      update: {},
      create: {
        name: 'Epson 664 Tinta Botol Hitam',
        sku: 'EPS-664-BK',
        categoryId: categories[2].id, // Tinta Botol
        brandId: brands[2].id,        // Epson
        printerModelId: printers[2].id,
        color: 'Black', currentStock: 5, minStock: 3, unit: 'botol',
      }
    }),
    prisma.product.upsert({
      where: { sku: 'EPS-664-CY' },
      update: {},
      create: {
        name: 'Epson 664 Tinta Botol Cyan',
        sku: 'EPS-664-CY',
        categoryId: categories[2].id,
        brandId: brands[2].id,
        printerModelId: printers[2].id,
        color: 'Cyan', currentStock: 1, minStock: 3, unit: 'botol',
      }
    }),
    prisma.product.upsert({
      where: { sku: 'BRO-TN2380' },
      update: {},
      create: {
        name: 'Brother TN-2380 Black Toner',
        sku: 'BRO-TN2380',
        categoryId: categories[1].id,
        brandId: brands[3].id,
        printerModelId: printers[3].id,
        color: 'Black', currentStock: 4, minStock: 3, unit: 'pcs',
      }
    }),
  ]);

  console.log('✅ Seeding selesai!');
}

main()
  .catch((e) => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
