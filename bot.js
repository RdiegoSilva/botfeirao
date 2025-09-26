const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcode_terminal = require('qrcode-terminal');
const express = require('express');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

const DEBUG = true;
const WARNING_COOLDOWN_MS = 7000;
let qrImageBase64 = '';

let BOT_ID = null;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'bot-session' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

const lastWarningAt = new Map();

function log(...args) {
  if (DEBUG) console.log(...args);
}

// Página HTML que carrega a imagem e atualiza automaticamente
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>QR Code WhatsApp</title></head>
      <body style="text-align:center; font-family: Arial, sans-serif; padding: 30px;">
        <h2>📱 Escaneie o QR Code com seu WhatsApp</h2>
        <img id="qr" width="300" src="" alt="QR Code aguardando..." />
        <p id="msg">Aguardando QR code...</p>
        <script>
          async function fetchQr() {
            try {
              const res = await fetch('/qr-image');
              const data = await res.json();
              const img = document.getElementById('qr');
              const msg = document.getElementById('msg');
              if(data.qr) {
                img.src = data.qr;
                msg.textContent = 'QR Code atualizado. Escaneie!';
              } else {
                img.src = '';
                msg.textContent = 'Aguardando QR code...';
              }
            } catch (e) {
              console.error(e);
            }
          }
          fetchQr();
          setInterval(fetchQr, 3000); // Atualiza a cada 3 segundos
        </script>
      </body>
    </html>
  `);
});

// Endpoint que retorna o QR code atual em base64
app.get('/qr-image', (req, res) => {
  res.json({ qr: qrImageBase64 });
});

app.listen(PORT, () => {
  console.log(`🌐 Acesse o QR Code em http://localhost:${PORT}`);
});

// Evento QR
client.on('qr', async (qr) => {
  try {
    qrcode_terminal.generate(qr, { small: true });
    qrImageBase64 = await qrcode.toDataURL(qr);
    log('✅ QR code atualizado.');
  } catch (err) {
    console.error('Erro ao gerar QR Code:', err);
  }
});

// Bot pronto
client.on('ready', () => {
  log('🤖 Bot conectado!');
  try {
    BOT_ID = normalizeId(client.info?.wid || client.info?.me || client.info);
    log('BOT_ID:', BOT_ID);
  } catch (e) {
    console.error('Erro ao capturar BOT_ID:', e);
  }
  scheduleGroupControl();
});

// Demais funções do bot continuam as mesmas...

// --- Funções auxiliares, comandos e controle de grupos aqui ---

function normalizeId(id) {
  if (!id) return null;
  if (typeof id === 'string') return id;
  if (id._serialized) return id._serialized;
  if (id.user) return `${id.user}@c.us`;
  if (id.id && id.id._serialized) return id.id._serialized;
  return null;
}

function findParticipantById(chat, idSerialized) {
  return chat?.participants?.find(p => {
    const pid = p.id._serialized || `${p.id.user}@c.us`;
    return pid === idSerialized;
  });
}

async function ensureChatParticipants(chat) {
  try {
    if (!chat || chat.participants?.length) return;
    await chat.fetch();
  } catch (e) {
    console.error('Erro ao carregar participantes:', e);
  }
}

async function closeGroup(chat) {
  try {
    await ensureChatParticipants(chat);
    const botParticipant = findParticipantById(chat, BOT_ID);
    if (!botParticipant?.isAdmin) return;
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
    const botParticipant = findParticipantById(chat, BOT_ID);
    if (!botParticipant?.isAdmin) return;
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
    log('⏰ Fechando grupos (22h)...');
    try {
      const chats = await client.getChats();
      for (const chat of chats) {
        if (chat.isGroup) await closeGroup(chat);
      }
    } catch (e) {
      console.error('Erro ao fechar grupos:', e);
    }
  }, { timezone: 'America/Fortaleza' });

  cron.schedule('0 7 * * *', async () => {
    log('⏰ Abrindo grupos (07h)...');
    try {
      const chats = await client.getChats();
      for (const chat of chats) {
        if (chat.isGroup) await openGroup(chat);
      }
    } catch (e) {
      console.error('Erro ao abrir grupos:', e);
    }
  }, { timezone: 'America/Fortaleza' });
}

// Comandos e bloqueios de links

client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();
    if (!chat.isGroup) return;

    await ensureChatParticipants(chat);
    const senderContact = await msg.getContact();
    const rawSender = msg.author || senderContact?.id || msg.from;
    const SENDER_ID = normalizeId(rawSender);

    const senderParticipant = findParticipantById(chat, SENDER_ID);
    const senderIsAdmin = senderParticipant?.isAdmin || senderParticipant?.isSuperAdmin;

    const botParticipant = findParticipantById(chat, BOT_ID);
    const botIsAdmin = botParticipant?.isAdmin || botParticipant?.isSuperAdmin;

    const text = (msg.body || '').toString().trim().toLowerCase();

    // Comando !link
    if (text === '!link') {
      try {
        const inviteCode = await chat.getInviteCode();
        await chat.sendMessage(`🔗 Link do grupo: https://chat.whatsapp.com/${inviteCode}`);
      } catch (err) {
        await chat.sendMessage('❌ Não consegui obter o link. Verifique se sou admin.');
      }
      return;
    }

    // Bloqueio de links
    const prohibitedLinks = /(?:https?:\/\/\S+|www\.\S+|tiktok\.com|kwai\.com|mercadolivre\.com|shopee\.com|instagram\.com|wa\.me)/i;

    if (prohibitedLinks.test(text)) {
      if (senderIsAdmin || !botIsAdmin) return;

      const chatIdKey = normalizeId(chat.id?._serialized);
      const last = lastWarningAt.get(chatIdKey) || 0;
      if (Date.now() - last < WARNING_COOLDOWN_MS) {
        try { await msg.delete(true); } catch (e) {}
        return;
      }

      try {
        await msg.delete(true);
        await chat.sendMessage(`⚠️ @${senderContact.number} — *Proibido enviar links!* ❌`, {
          mentions: [senderContact]
        });
        lastWarningAt.set(chatIdKey, Date.now());
      } catch (err) {
        console.error('Erro ao avisar:', err);
      }
    }

  } catch (err) {
    console.error('Erro no processamento da mensagem:', err);
  }
});

client.initialize();
