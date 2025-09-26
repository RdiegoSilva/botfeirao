const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const DEBUG = true;
const WARNING_COOLDOWN_MS = 7000;

let BOT_ID = null;
let lastQRCode = null;
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
    if (!p || !p.id) return false;
    const pid = p.id._serialized || (p.id.user ? `${p.id.user}@c.us` : null);
    return pid === idSerialized;
  });
}

async function ensureChatParticipants(chat) {
  try {
    if (!chat) {
      log('ensureChatParticipants: chat indefinido');
      return;
    }

    if (chat.participants && chat.participants.length > 0) {
      return;
    }

    if (typeof chat.fetch === 'function') {
      log('ensureChatParticipants: chamando chat.fetch()...');
      await chat.fetch();
      if (chat.participants && chat.participants.length > 0) {
        log('ensureChatParticipants: participantes carregados depois fetch');
        return;
      }
    }

    // fallback
    try {
      const allChats = await client.getChats();
      for (const c of allChats) {
        if (c.id && chat.id && c.id._serialized === chat.id._serialized) {
          if (c.participants && c.participants.length > 0) {
            chat.participants = c.participants;
            log('ensureChatParticipants: participantes atribuídos via fallback');
            return;
          }
        }
      }
      log('ensureChatParticipants: fallback não encontrou participantes');
    } catch (er) {
      log('Erro no fallback getChats:', er);
    }
  } catch (err) {
    log('Erro em ensureChatParticipants:', err);
  }
}

// Criação do client com flags extras
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
    // Se possível, definir executablePath se souber do chromium no Render
    // executablePath: '/usr/bin/chromium-browser'
  },
  // Possível experimento se precisar:
  // webVersionCache: {
  //   type: 'remote',
  //   remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1014590669-alpha.html'
  // }
});

// Eventos pra debugar

client.on('qr', async (qr) => {
  lastQRCode = qr;
  qrcodeTerminal.generate(qr, { small: true });
  log('📲 QR code emitido.');
});

client.on('authenticated', () => {
  log('🔐 Autenticado com sucesso!');
});

client.on('auth_failure', msg => {
  log('❌ Falha na autenticação:', msg);
});

client.on('ready', () => {
  log('✅ Cliente pronto (ready).');
  try {
    const info = client.info || {};
    BOT_ID = normalizeId(info.wid || info.me || info);
    log('BOT_ID:', BOT_ID);
  } catch (e) {
    log('Erro ao definir BOT_ID:', e);
  }
  scheduleGroupControl();
});

client.on('change_state', state => {
  log('🔄 Estado mudou:', state);
});

client.on('disconnected', reason => {
  log('⚠️ Cliente desconectado:', reason);
  // tentar reconectar
  client.initialize();
});

// Mensagens, comandos, etc (igual ao seu código original, com ensureChatParticipants)
client.on('message', async msg => {
  try {
    const chat = await msg.getChat();
    if (!chat || !chat.isGroup) return;

    await ensureChatParticipants(chat);
    const senderContact = await msg.getContact().catch(e => {
      log('Erro getContact:', e);
      return null;
    });
    if (!senderContact) return;

    const rawSender = msg.author || senderContact.id || msg.from;
    const SENDER_ID = normalizeId(rawSender);

    const senderParticipant = findParticipantById(chat, SENDER_ID);
    const senderIsAdmin = Boolean(senderParticipant && (senderParticipant.isAdmin || senderParticipant.isSuperAdmin));

    if (!BOT_ID && client.info) {
      BOT_ID = normalizeId(client.info.wid || client.info.me);
    }

    const botParticipant = findParticipantById(chat, BOT_ID);
    const botIsAdmin = Boolean(botParticipant && (botParticipant.isAdmin || botParticipant.isSuperAdmin));

    const text = (msg.body || '').trim().toLowerCase();

    if (text === '!link') {
      try {
        const inviteCode = await chat.getInviteCode();
        const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
        await chat.sendMessage(`🔗 Link do grupo: ${inviteLink}`);
      } catch (err) {
        log('Erro no !link:', err);
        await chat.sendMessage('❌ Não consegui gerar o link. Verifique se sou admin.');
      }
      return;
    }

    const prohibitedLinks = /(?:https?:\/\/\S+|www\.\S+|tiktok\.com|kwai\.com|mercadolivre\.com|shopee\.com|instagram\.com|wa\.me)/i;
    if (prohibitedLinks.test(text)) {
      if (senderIsAdmin || !botIsAdmin) return;

      const key = normalizeId(chat.id);
      const last = lastWarningAt.get(key) || 0;
      if (Date.now() - last < WARNING_COOLDOWN_MS) {
        try { await msg.delete(true); } catch(e) {}
        return;
      }

      try {
        await msg.delete(true);
        await chat.sendMessage(`⚠️ @${senderContact.number} — *Proibido enviar links!*`, {
          mentions: [senderContact]
        });
        lastWarningAt.set(key, Date.now());
      } catch(err2) {
        log('Erro apagar/avisar:', err2);
      }
    }

  } catch (err) {
    log('Erro evento message:', err);
  }
});

// Funções de controle de grupo
async function closeGroup(chat) {
  try {
    await ensureChatParticipants(chat);
    const botPart = findParticipantById(chat, BOT_ID);
    if (!botPart?.isAdmin) return;
    if (typeof chat.setMessagesAdminsOnly === 'function') {
      await chat.setMessagesAdminsOnly(true);
    }
    await chat.sendMessage('*🔒 Grupo fechado! Boa noite! 😴*');
  } catch (e) {
    log('Erro fechar grupo:', e);
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
    await chat.sendMessage('*🔓 Grupo aberto! Bom dia! ☀️*');
  } catch (e) {
    log('Erro abrir grupo:', e);
  }
}

function scheduleGroupControl() {
  cron.schedule('0 22 * * *', async () => {
    log('🔒 Fechando grupos às 22:00');
    try {
      const chats = await client.getChats();
      for (const c of chats) {
        if (c.isGroup) await closeGroup(c);
      }
    } catch (e) {
      log('Erro fechar grupos:', e);
    }
  }, { timezone: 'America/Fortaleza' });

  cron.schedule('0 7 * * *', async () => {
    log('🔓 Abrindo grupos às 07:00');
    try {
      const chats = await client.getChats();
      for (const c of chats) {
        if (c.isGroup) await openGroup(c);
      }
    } catch (e) {
      log('Erro abrir grupos:', e);
    }
  }, { timezone: 'America/Fortaleza' });
}

// Servir QR code imagem
app.get('/qr-image', async (req, res) => {
  if (!lastQRCode) {
    log('Solicitado /qr-image sem QR');
    return res.status(404).send('QR Code ainda não gerado.');
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
    log('Erro no /qr-image:', e);
    res.status(500).send('Erro interno gerar imagem QR.');
  }
});

// Página para ver QR com auto refresh
app.get('/', (req, res) => {
  res.send(`
    <html><body style="text-align:center;font-family:sans-serif;padding:30px;">
      <h1>WhatsApp Bot QR</h1>
      <img id="qr" src="/qr-image" width="300" alt="QR Code"/>
      <p>Atualizando QR a cada 5 segundos</p>
      <script>
        setInterval(() => {
          const img = document.getElementById('qr');
          img.src = '/qr-image?' + new Date().getTime();
        }, 5000);
      </script>
    </body></html>
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  log('Servidor rodando na porta', PORT);
});

client.initialize();
