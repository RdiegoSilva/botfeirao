const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');  // para gerar imagem base64
const qrcodeTerminal = require('qrcode-terminal');  // terminal
const express = require('express');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const DEBUG = true;
const WARNING_COOLDOWN_MS = 7000;

let lastQRCode = null;
let BOT_ID = null;
const lastWarningAt = new Map();

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'bot-session' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote'
    ]
  }
});

// ===== UTILS =====

function log(...args) {
  if (DEBUG) console.log(...args);
}

function normalizeId(id) {
  if (!id) return null;
  if (typeof id === 'string') return id;
  if (id._serialized) return id._serialized;
  if (id.user) return `${id.user}@c.us`;
  try {
    if (id.id && id.id._serialized) return id.id._serialized;
  } catch {}
  return null;
}

function findParticipantById(chat, idSerialized) {
  if (!chat || !chat.participants || !idSerialized) return undefined;
  return chat.participants.find(p => {
    const pid = normalizeId(p.id);
    return pid === idSerialized;
  });
}

async function ensureChatParticipants(chat) {
  try {
    if (!chat) return;
    if (chat.participants && chat.participants.length > 0) return;
    if (typeof chat.fetch === 'function') await chat.fetch();
    if (chat.participants && chat.participants.length > 0) return;
    const all = await client.getChats();
    const found = all.find(c => normalizeId(c.id) === normalizeId(chat.id));
    if (found && found.participants) chat.participants = found.participants;
  } catch (e) {
    console.error('Erro em ensureChatParticipants:', e);
  }
}

// ===== EVENTOS =====

client.on('qr', (qr) => {
  lastQRCode = qr;
  log('📲 Novo QR gerado!');
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('ready', () => {
  log('✅ Cliente conectado!');
  if (client.info) BOT_ID = normalizeId(client.info.wid);
  scheduleGroupControl();
});

client.on('auth_failure', (msg) => {
  console.error('❌ Falha na autenticação:', msg);
});

client.on('message', async msg => {
  try {
    const chat = await msg.getChat();
    if (!chat.isGroup) return;

    await ensureChatParticipants(chat);

    const senderContact = await msg.getContact();
    const SENDER_ID = normalizeId(msg.author || senderContact.id || msg.from);

    const senderParticipant = findParticipantById(chat, SENDER_ID);
    const senderIsAdmin = Boolean(senderParticipant?.isAdmin || senderParticipant?.isSuperAdmin);

    const botParticipant = findParticipantById(chat, BOT_ID);
    const botIsAdmin = Boolean(botParticipant?.isAdmin || botParticipant?.isSuperAdmin);

    const text = msg.body?.trim().toLowerCase();

    if (text === '!link') {
      try {
        const inviteCode = await chat.getInviteCode();
        const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
        await chat.sendMessage(`🔗 Link do grupo: ${inviteLink}`);
      } catch (err) {
        await chat.sendMessage('*❌ Não consegui obter o link. Me torne admin.*');
      }
      return;
    }

    const prohibitedLinks = /(?:https?:\/\/\S+|www\.\S+|tiktok\.com|kwai\.com|mercadolivre|shopee|instagram\.com|wa\.me)/i;

    if (prohibitedLinks.test(text)) {
      if (senderIsAdmin || !botIsAdmin) return;

      const chatIdKey = normalizeId(chat.id);
      const last = lastWarningAt.get(chatIdKey) || 0;
      if (Date.now() - last < WARNING_COOLDOWN_MS) {
        try { await msg.delete(true); } catch {}
        return;
      }

      try {
        await msg.delete(true);
        await chat.sendMessage(`⚠️ @${senderContact.number} — *Proibido enviar links!* ❌`, {
          mentions: [senderContact]
        });
        lastWarningAt.set(chatIdKey, Date.now());
      } catch (err) {
        console.error('Erro ao deletar/avisar:', err);
      }
    }

  } catch (err) {
    console.error('Erro na mensagem:', err);
  }
});

// ===== CONTROLE DE GRUPO =====

async function closeGroup(chat) {
  try {
    await ensureChatParticipants(chat);
    const botParticipant = findParticipantById(chat, BOT_ID);
    if (!botParticipant?.isAdmin) return;
    await chat.setMessagesAdminsOnly(true);
    await chat.sendMessage('*🔒 Grupo fechado! Boa noite!* 😴');
  } catch (e) {
    console.error('Erro ao fechar grupo:', e);
  }
}

async function openGroup(chat) {
  try {
    await ensureChatParticipants(chat);
    const botParticipant = findParticipantById(chat, BOT_ID);
    if (!botParticipant?.isAdmin) return;
    await chat.setMessagesAdminsOnly(false);
    await chat.sendMessage('*🔓 Grupo aberto! Bom dia!* ☀️');
  } catch (e) {
    console.error('Erro ao abrir grupo:', e);
  }
}

function scheduleGroupControl() {
  cron.schedule('0 22 * * *', async () => {
    log('🔒 Fechando grupos (22:00)...');
    const chats = await client.getChats();
    for (const c of chats) {
      if (c.isGroup) await closeGroup(c);
    }
  }, { timezone: 'America/Fortaleza' });

  cron.schedule('0 7 * * *', async () => {
    log('🔓 Abrindo grupos (07:00)...');
    const chats = await client.getChats();
    for (const c of chats) {
      if (c.isGroup) await openGroup(c);
    }
  }, { timezone: 'America/Fortaleza' });
}

// ===== EXPRESS SERVER =====

app.get('/qr-image', async (req, res) => {
  if (!lastQRCode) {
    return res.status(404).send('QR Code ainda não gerado.');
  }
  try {
    const dataUrl = await qrcode.toDataURL(lastQRCode);
    const img = Buffer.from(dataUrl.split(',')[1], 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(img);
  } catch (err) {
    console.error('Erro ao gerar QR:', err);
    res.status(500).send('Erro ao gerar imagem.');
  }
});

// ===== INICIAR =====

app.listen(PORT, '0.0.0.0', () => {
  log(`🌐 Servidor online — http://localhost:${PORT}/qr-image`);
});

client.initialize();
