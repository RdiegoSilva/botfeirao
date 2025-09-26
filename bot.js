const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');           // para gerar QR em base64 para imagem
const qrcodeTerminal = require('qrcode-terminal');  // para mostrar QR no terminal
const express = require('express');
const cron = require('node-cron');

const app = express();
const DEBUG = true;
const WARNING_COOLDOWN_MS = 7000;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'bot-session' }),
  puppeteer: {
    headless: 'new',  // modo headless correto para ambiente sem X11
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-infobars',
      '--window-size=1280,720',
      '--hide-scrollbars',
      '--single-process',
      '--no-zygote'
    ]
  }
});

const lastWarningAt = new Map();

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
  } catch (e) {}
  return null;
}

function findParticipantById(chat, idSerialized) {
  if (!chat || !chat.participants || !idSerialized) return undefined;
  return chat.participants.find(p => {
    if (!p || !p.id) return false;
    const pid = p.id._serialized || (p.id.user ? `${p.id.user}@c.us` : null) || (p.id.id && p.id.id._serialized ? p.id.id._serialized : null);
    return pid === idSerialized;
  });
}

async function ensureChatParticipants(chat) {
  try {
    if (!chat) return;
    if (chat.participants && chat.participants.length > 0) return;
    if (typeof chat.fetch === 'function') {
      log('Tentando chat.fetch()...');
      await chat.fetch();
      if (chat.participants && chat.participants.length > 0) return;
    }
    const all = await client.getChats();
    const found = all.find(c => normalizeId(c.id && c.id._serialized) === normalizeId(chat.id && chat.id._serialized));
    if (found && found.participants && found.participants.length > 0) {
      chat.participants = found.participants;
      log('Participantes carregados via fallback getChats().');
    }
  } catch (e) {
    console.error('Erro em ensureChatParticipants:', e);
  }
}

let BOT_ID = null;
let lastQRCode = null;

// Evento QR — atualiza variável lastQRCode e mostra QR no terminal
client.on('qr', async (qr) => {
  lastQRCode = qr;
  qrcodeTerminal.generate(qr, { small: true });
  log('📲 QR gerado — escaneie com o WhatsApp.');
});

// Cliente pronto
client.on('ready', () => {
  log('✅ Cliente pronto!');
  try {
    const info = client.info || {};
    BOT_ID = normalizeId(info.wid || info.me || info);
    log('BOT_ID determinado:', BOT_ID);
  } catch (e) {
    console.error('Não consegui determinar BOT_ID:', e);
  }
  scheduleGroupControl();
});

client.on('message', async msg => {
  try {
    const chat = await msg.getChat();
    if (!chat || !chat.isGroup) return;

    await ensureChatParticipants(chat);
    const senderContact = await msg.getContact();
    const rawSender = msg.author || (senderContact && senderContact.id) || msg.from;
    const SENDER_ID = normalizeId(rawSender);

    const senderParticipant = findParticipantById(chat, SENDER_ID);
    const senderIsAdmin = Boolean(senderParticipant && (senderParticipant.isAdmin || senderParticipant.isSuperAdmin));

    if (!BOT_ID && client.info) {
      BOT_ID = normalizeId(client.info.wid || client.info.me || client.info);
    }

    const botParticipant = findParticipantById(chat, BOT_ID);
    const botIsAdmin = Boolean(botParticipant && (botParticipant.isAdmin || botParticipant.isSuperAdmin));

    const text = (msg.body || '').toString().trim().toLowerCase();

    // Comando !link — envia link do grupo
    if (text === '!link') {
      try {
        const inviteCode = await chat.getInviteCode();
        const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
        await chat.sendMessage(`🔗 Link do grupo: ${inviteLink}`);
      } catch (err) {
        console.error('Erro ao gerar link:', err);
        await chat.sendMessage('*❌ Não consegui obter o link. Verifique se sou admin do grupo.*');
      }
      return;
    }

    // Bloqueio de links proibidos
    const prohibitedLinks = /(?:https?:\/\/\S+|www\.\S+|tiktok\.com|kwai\.com|mercadolivre\.com|shopee\.com|instagram\.com|wa\.me)/i;

    if (prohibitedLinks.test(text)) {
      if (senderIsAdmin) return;
      if (!botIsAdmin) return;

      const chatIdKey = normalizeId(chat.id && chat.id._serialized) || chat.id;
      const last = lastWarningAt.get(chatIdKey) || 0;
      if (Date.now() - last < WARNING_COOLDOWN_MS) {
        try { await msg.delete(true); } catch (e) {}
        return;
      }

      try {
        await msg.delete(true);
        const mention = senderContact ? [senderContact] : [];
        await chat.sendMessage(`⚠️ @${senderContact.number} — *Proibido enviar links! ❌*`, {
          mentions: mention
        });
        lastWarningAt.set(chatIdKey, Date.now());
      } catch (err) {
        console.error('Erro ao apagar ou avisar:', err);
      }
    }

  } catch (err) {
    console.error('Erro na mensagem:', err);
  }
});

// Função para fechar grupo (apenas admins)
const closeGroup = async (chat) => {
  try {
    await ensureChatParticipants(chat);
    const botParticipant = findParticipantById(chat, BOT_ID);
    if (!botParticipant || !botParticipant.isAdmin) return;
    if (typeof chat.setMessagesAdminsOnly === 'function') {
      await chat.setMessagesAdminsOnly(true);
    }
    await chat.sendMessage('*🔒 Grupo fechado! Boa noite! 😴*');
  } catch (e) {
    console.error('Erro ao fechar grupo:', e);
  }
};

// Função para abrir grupo (apenas admins)
const openGroup = async (chat) => {
  try {
    await ensureChatParticipants(chat);
    const botParticipant = findParticipantById(chat, BOT_ID);
    if (!botParticipant || !botParticipant.isAdmin) return;
    if (typeof chat.setMessagesAdminsOnly === 'function') {
      await chat.setMessagesAdminsOnly(false);
    }
    await chat.sendMessage('*🔓 Grupo aberto! Bom dia! ☀️*');
  } catch (e) {
    console.error('Erro ao abrir grupo:', e);
  }
};

// Cron para fechar grupo às 22h e abrir às 7h (horário America/Fortaleza)
const scheduleGroupControl = () => {
  cron.schedule('0 22 * * *', async () => {
    log('🔒 Fechando grupos (22:00)...');
    try {
      const chats = await client.getChats();
      for (const c of chats) {
        if (c.isGroup) await closeGroup(c);
      }
    } catch (e) {
      console.error('Erro ao fechar grupos:', e);
    }
  }, { timezone: 'America/Fortaleza' });

  cron.schedule('0 7 * * *', async () => {
    log('🔓 Abrindo grupos (07:00)...');
    try {
      const chats = await client.getChats();
      for (const c of chats) {
        if (c.isGroup) await openGroup(c);
      }
    } catch (e) {
      console.error('Erro ao abrir grupos:', e);
    }
  }, { timezone: 'America/Fortaleza' });
};

// Endpoint para servir a imagem do QR Code sempre atualizada
app.get('/qr-image', async (req, res) => {
  if (!lastQRCode) {
    return res.status(404).send('QR Code ainda não gerado, aguarde...');
  }
  try {
    const dataUrl = await qrcode.toDataURL(lastQRCode);
    const img = Buffer.from(dataUrl.split(',')[1], 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
    });
    res.end(img);
  } catch (e) {
    res.status(500).send('Erro ao gerar QR Code');
  }
});

// Página simples para visualizar o QR Code no browser
app.get('/', (req, res) => {
  if (!lastQRCode) {
    return res.send('<h3>QR Code ainda não gerado, aguarde...</h3>');
  }
  res.send(`
    <html>
      <head>
        <title>WhatsApp QR Code</title>
        <meta http-equiv="refresh" content="10" />
        <style>
          body { display:flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: Arial, sans-serif; }
          img { width: 300px; height: 300px; }
          p { margin-top: 10px; }
        </style>
      </head>
      <body>
        <h2>Escaneie o QR Code para conectar o WhatsApp</h2>
        <img src="/qr-image" alt="QR Code WhatsApp" />
        <p>A página atualiza a cada 10 segundos automaticamente.</p>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  log(`🌐 Servidor rodando na porta ${PORT}`);
});

client.initialize();
