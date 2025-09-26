const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const DEBUG = true;

let BOT_ID = null;
let lastQRCode = null;
const lastWarningAt = new Map();

function log(...args) {
  if (DEBUG) console.log(...args);
}

// Criação do cliente com ajustes para ambiente de nuvem
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'bot-session' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote',
      '--disable-gpu',
      '--window-size=1280,720'
    ],
    // Se souber caminho do Chromium no servidor, define aqui
    // executablePath: '/usr/bin/chromium-browser' // <-- ajuste isso conforme o ambiente do Render
  }
});

// QR event: atualizar e exibir no terminal
client.on('qr', async (qr) => {
  lastQRCode = qr;
  qrcodeTerminal.generate(qr, { small: true });
  log('📲 QR gerado:', qr);
});

// Quando o cliente estiver pronto
client.on('ready', () => {
  log('✅ Cliente pronto!');
  try {
    const info = client.info || {};
    BOT_ID = (info.wid || info.me || info)._serialized || (info.me && info.me._serialized);
    log('BOT_ID:', BOT_ID);
  } catch (e) {
    console.error('Erro ao obter BOT_ID:', e);
  }
  scheduleGroupControl();
});

// Mensagens e comandos
client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();
    if (!chat || !chat.isGroup) return;

    await ensureChatParticipants(chat);
    const senderContact = await msg.getContact();
    const rawSender = msg.author || senderContact?.id || msg.from;
    const SENDER_ID = normalizeId(rawSender);

    const senderParticipant = findParticipantById(chat, SENDER_ID);
    const senderIsAdmin = senderParticipant?.isAdmin || senderParticipant?.isSuperAdmin;

    if (!BOT_ID && client.info) {
      BOT_ID = normalizeId(client.info.wid || client.info.me);
    }
    const botParticipant = findParticipantById(chat, BOT_ID);
    const botIsAdmin = botParticipant?.isAdmin || botParticipant?.isSuperAdmin;

    const text = (msg.body || '').trim().toLowerCase();

    if (text === '!link') {
      try {
        const inviteCode = await chat.getInviteCode();
        const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
        await chat.sendMessage(`🔗 Link do grupo: ${inviteLink}`);
      } catch (err) {
        console.error('Erro ao gerar link:', err);
        await chat.sendMessage('❌ Não consegui obter o link.');
      }
      return;
    }

    const prohibitedLinks = /(?:https?:\/\/\S+|www\.\S+|tiktok\.com|kwai\.com|mercadolivre\.com|shopee\.com|instagram\.com|wa\.me)/i;
    if (prohibitedLinks.test(text)) {
      if (senderIsAdmin || !botIsAdmin) return;

      const chatIdKey = normalizeId(chat.id) || '';
      const last = lastWarningAt.get(chatIdKey) || 0;
      if (Date.now() - last < 7000) {
        try { await msg.delete(true); } catch (_) {}
        return;
      }

      try {
        await msg.delete(true);
        await chat.sendMessage(`⚠️ @${senderContact.number} — *Proibido enviar links!* ❌`, {
          mentions: [senderContact]
        });
        lastWarningAt.set(chatIdKey, Date.now());
      } catch (err) {
        console.error('Erro no apagar/aviso:', err);
      }
    }

  } catch (err) {
    console.error('Erro no evento message:', err);
  }
});

// Funções auxiliares

function normalizeId(id) {
  if (!id) return null;
  if (typeof id === 'string') return id;
  if (id._serialized) return id._serialized;
  if (id.user) return `${id.user}@c.us`;
  try {
    if (id.id && id.id._serialized) return id.id._serialized;
  } catch (e) {}
  return null;
}

function findParticipantById(chat, idSerialized) {
  return chat?.participants?.find(p => {
    const pid = p.id._serialized || (p.id.user ? `${p.id.user}@c.us` : null);
    return pid === idSerialized;
  });
}

async function ensureChatParticipants(chat) {
  try {
    if (chat.participants?.length > 0) return;
    if (typeof chat.fetch === 'function') {
      await chat.fetch();
    }
  } catch (e) {
    console.error('Erro em ensureChatParticipants:', e);
  }
}

async function closeGroup(chat) {
  try {
    await ensureChatParticipants(chat);
    const botPart = findParticipantById(chat, BOT_ID);
    if (!botPart?.isAdmin) return;
    if (typeof chat.setMessagesAdminsOnly === 'function') {
      await chat.setMessagesAdminsOnly(true);
    }
    await chat.sendMessage('*🔒 Grupo fechado! Boa noite!*');
  } catch (e) {
    console.error('Erro ao fechar grupo:', e);
  }
}

async function openGroup(chat) {
  try {
    await ensureChatParticipants(chat);
    const botPart = findParticipantById(chat, BOT_ID);
    if (!botPart?.isAdmin) return;
    if (typeof chat.setMessagesAdminsOnly === 'function') {
      await chat.setMessagesAdminsOnly(false);
    }
    await chat.sendMessage('*🔓 Grupo aberto! Bom dia!*');
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

// Rota para servir o QR como imagem PNG
app.get('/qr-image', async (req, res) => {
  if (!lastQRCode) {
    log('Solicitado /qr-image, mas QR ainda não gerado.');
    return res.status(404).send('QR Code ainda não gerado.');
  }
  try {
    const dataUrl = await qrcode.toDataURL(lastQRCode);
    const img = Buffer.from(dataUrl.split(',')[1], 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    res.end(img);
  } catch (e) {
    console.error('Erro ao converter QR para imagem:', e);
    res.status(500).send('Erro no servidor.');
  }
});

// Página simples para exibir o QR e atualizar
app.get('/', (req, res) => {
  res.send(`
    <html>
    <head><title>QR WA Bot</title></head>
    <body style="text-align:center; font-family: sans-serif;">
      <h1>Escaneie este QR Code com WhatsApp</h1>
      <img id="qr" src="/qr-image" width="300" alt="QR Code" />
      <p>A página atualiza a cada 5 segundos.</p>
      <script>
        setInterval(() => {
          const img = document.getElementById('qr');
          img.src = '/qr-image?' + new Date().getTime();
        }, 5000);
      </script>
    </body>
    </html>
  `);
});

// Iniciar servidor Express
app.listen(PORT, '0.0.0.0', () => {
  log('Servidor rodando na porta', PORT);
});

// Inicializa WhatsApp client
client.initialize();
