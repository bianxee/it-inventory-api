// src/lib/telegramNotification.js
const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const bot = TOKEN && CHAT_ID ? new TelegramBot(TOKEN, { polling: false }) : null;

async function sendLowStockAlert(product, quantityTaken) {
  if (!bot || !CHAT_ID) {
    console.log('⚠️ Telegram Bot belum dikonfigurasi');
    return;
  }

  const sisa = product.currentStock;
  const isHabis = sisa === 0;
  const isMenipis = sisa <= product.minStock;

  let emoji = isHabis ? '🚨' : '⚠️';
  let status = isHabis ? 'HABIS TOTAL' : 'MENIPIS';

  const message = `
${emoji} *ALERT STOK KRITIS*

📦 *Produk*: ${product.name}
🔖 *SKU*: ${product.sku}
📉 *Diambil*: ${quantityTaken} ${product.unit}
📊 *Sisa Stok*: *${sisa}* ${product.unit}
⚠️ *Status*: ${status}
📍 *Minimum*: ${product.minStock} ${product.unit}

⏰ ${new Date().toLocaleString('id-ID')}
  `.trim();

  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log(`✅ Notifikasi Telegram terkirim: ${product.name}`);
  } catch (error) {
    console.error('❌ Gagal kirim Telegram:', error.message);
  }
}

module.exports = { sendLowStockAlert };