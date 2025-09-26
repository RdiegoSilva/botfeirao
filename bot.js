const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const DEBUG = true;
const WARNING_COOLDOWN_MS = 7000;

let lastQRCode = null;
let BOT_ID = null;
const lastWarningAt = new Map();

function log(...args) {
  if (DEBUG) console.log(new Date().toISOString(), ...args);
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
    const pid = normalizeId(p.id);
    return pid === idSerialized;
  });
}

async function ensureChatParticipants(chat) {
  try {
    if (!chat) return;
    if (chat.participants && chat.participants.length > 0) return;
    if (typeof chat.fetch === 'function') {
      await chat.fetch();
      if (chat.participants && chat.participants.length > 0) return;
    }
    const all = await client.getChats();
    const found = all.find(c => normalizeId(c.id) === normalizeId(chat.id));
    if (found && found.participants) {
      chat.participants = found.participants;
    }
  } catch (e) {
    console.error('Erro em ensureChatParticipants:', e);
  }
}

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

// Evento QR
client.on('qr', qr => {
  lastQRCode = qr;
  log('📲 Novo QR gerado');
  qrcodeTerminal.generate(qr, { small: true });
});

// Evento ready
client.on('ready', () => {
  log('✅ Cliente pronto!');
  if (client.info) {
    BOT_ID = normalizeId(client.info.wid || client.info.me);
    log('BOT_ID:', BOT_ID);
  }
  scheduleGroupControl();
});

// Falha de autenticação
client.on('auth_failure', msg => {
  console.error('❌ Falha na autenticação:', msg);
});

// Mensagens e comandos
client.on('message', async msg => {
  try {
    const chat = await msg.getChat();
    if (!chat || !chat.isGroup) return;

    await ensureChatParticipants(chat);

    const senderContact = await msg.getContact();
    const rawSender = msg.author || senderContact?.id || msg.from;
    const SENDER_ID = normalizeId(rawSender);
    const senderPart = findParticipantById(chat, SENDER_ID);
    const senderIsAdmin = senderPart?.isAdmin || senderPart?.isSuperAdmin;

    const botPart = findParticipantById(chat, BOT_ID);
    const botIsAdmin = botPart?.isAdmin || botPart?.isSuperAdmin;

    const text = (msg.body || '').trim().toLowerCase();

    // Comando !link
    if (text === '!link') {
      if (!botIsAdmin) {
        await chat.sendMessage('*❌ Preciso ser admin para gerar o link do grupo!*');
        return;
      }
      try {
        const inviteCode = await chat.getInviteCode();
        const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
        await chat.sendMessage(`🔗 Link do grupo: ${inviteLink}`);
      } catch (err) {
        console.error('Erro ao gerar link:', err);
        await chat.sendMessage('*❌ Não consegui gerar o link. Certifique-se que sou admin.*');
      }
      return;
    }

    // Bloqueio de links proibidos
    const prohibitedLinks = /(?:https?:\/\/\S+|www\.\S+|tiktok\.com|kwai\.com|mercadolivre\.com|shopee\.com|instagram\.com|wa\.me)/i;
    if (prohibitedLinks.test(text)) {
      if (senderIsAdmin || !botIsAdmin) return;

      const chatKey = normalizeId(chat.id);
      const last = lastWarningAt.get(chatKey) || 0;
      if (Date.now() - last < WARNING_COOLDOWN_MS) {
        try { await msg.delete(true); } catch {}
        return;
      }

      try {
        await msg.delete(true);
        await chat.sendMessage(`⚠️ @${senderContact.number} — *Proibido enviar links!* ❌`, {
          mentions: [senderContact]
        });
        lastWarningAt.set(chatKey, Date.now());
      } catch (err) {
        console.error('Erro apagar/avisar:', err);
      }
    }

  } catch (e) {
    console.error('Erro no message handler:', e);
  }
});

// Funções abrir/fechar grupo
async function closeGroup(chat) {
  try {
    await ensureChatParticipants(chat);
    const botPart = findParticipantById(chat, BOT_ID);
    if (!botPart?.isAdmin) return;
    await chat.setMessagesAdminsOnly(true);
    await chat.sendMessage('*🔒 Grupo fechado! Boa noite!*');
  } catch (e) {
    console.error('Erro fechar grupo:', e);
  }
}

async function openGroup(chat) {
  try {
    await ensureChatParticipants(chat);
    const botPart = findParticipantById(chat, BOT_ID);
    if (!botPart?.isAdmin) return;
    await chat.setMessagesAdminsOnly(false);
    await chat.sendMessage('*🔓 Grupo aberto! Bom dia!*');
  } catch (e) {
    console.error('Erro abrir grupo:', e);
  }
}

function scheduleGroupControl() {
  cron.schedule('0 22 * * *', async () => {
    log('🔒 Fechando grupos (22:00)...');
    const chats = await client.getChats().catch(e => { console.error('Erro getChats cron close:', e); return []; });
    for (const c of chats) {
      if (c.isGroup) await closeGroup(c);
    }
  }, { timezone: 'America/Fortaleza' });

  cron.schedule('0 7 * * *', async () => {
    log('🔓 Abrindo grupos (07:00)...');
    const chats = await client.getChats().catch(e => { console.error('Erro getChats cron open:', e); return []; });
    for (const c of chats) {
      if (c.isGroup) await openGroup(c);
    }
  }, { timezone: 'America/Fortaleza' });
}

// Rota principal para mostrar QR no navegador
app.get('/', (req, res) => {
  res.send(`
    <html><body style="text-align:center; font-family:sans-serif; padding:30px;">
      <h1>WhatsApp Bot QR</h1>
      <img id="qr" src="/qr-image" width="300" alt="QR Code" />
      <p>A página atualiza a cada 5 segundos.</p>
      <script>
        setInterval(() => {
          document.getElementById('qr').src = '/qr-image?' + new Date().getTime();
        }, 5000);
      </script>
    </body></html>
  `);
});

// Rota para servir a imagem do QR Code
app.get('/qr-image', async (req, res) => {
  if (!lastQRCode) {
    return res.status(404).send('QR Code ainda não gerado.');
  }
  try {
    const dataUrl = await qrcode.toDataURL(lastQRCode);
    const img = Buffer.from(dataUrl.split(',')[1], 'base64');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length
    });
    res.end(img);
  } catch (err) {
    console.error('Erro ao gerar QR imagem:', err);
    res.status(500).send('Erro ao gerar QR Code.');
  }
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  log(`🌐 Servidor rodando na porta ${PORT}`);
});

client.initialize();
