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
      log('ensureChatParticipants: chat é nulo');
      return;
    }
    if (chat.participants && chat.participants.length > 0) {
      return;
    }
    if (typeof chat.fetch === 'function') {
      log('ensureChatParticipants: chamando chat.fetch()');
      await chat.fetch();
      if (chat.participants && chat.participants.length > 0) {
        log('ensureChatParticipants: participantes obtidos após fetch');
        return;
      }
    }
    try {
      const allChats = await client.getChats();
      const found = allChats.find(c => {
        const a = c.id && c.id._serialized;
        const b = chat.id && chat.id._serialized;
        return normalizeId(a) === normalizeId(b);
      });
      if (found && found.participants && found.participants.length > 0) {
        chat.participants = found.participants;
        log('ensureChatParticipants: participantes atribuídos via fallback');
        return;
      } else {
        log('ensureChatParticipants: fallback não encontrou participantes');
      }
    } catch (e2) {
      log('Fallback getChats erro:', e2);
    }
  } catch (err) {
    log('Erro em ensureChatParticipants:', err);
  }
}

// Escolha uma versão estável conhecida ou teste algumas
const stableWebVersion = '2.3000.1014590669-alpha.html';

// Cria cliente com webVersionCache para “fixar” versão
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'bot-session' }),
  puppeteer: {
    headless: false,    // para você ver o navegador no servidor (se possível)
    dumpio: true,       // imprime os logs do Chromium no console
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote',
      '--disable-gpu',
      '--window-size=1280,720'
    ]
    // Se souber o caminho do Chrome no servidor, adicione:
    // executablePath: '/usr/bin/chromium-browser'
  },
  webVersionCache: {
    type: 'remote',
    remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${stableWebVersion}`
  },
  takeoverOnConflict: true  // tenta assumir sessão se ela já estiver ativa em outro dispositivo
});

// Evento QR
client.on('qr', async (qr) => {
  lastQRCode = qr;
  qrcodeTerminal.generate(qr, { small: true });
  log('📲 QR gerado:', qr);
});

// Evento autenticado
client.on('authenticated', () => {
  log('🔐 Evento authenticated disparado.');
});

// Falha na autenticação
client.on('auth_failure', msg => {
  log('❌ auth_failure:', msg);
});

// Pronto
client.on('ready', () => {
  log('✅ Evento ready disparado.');
  try {
    const info = client.info || {};
    BOT_ID = normalizeId(info.wid || info.me || info);
    log('BOT_ID:', BOT_ID);
  } catch (e) {
    log('Erro ao definir BOT_ID:', e);
  }
  scheduleGroupControl();
});

// Mudança de estado
client.on('change_state', state => {
  log('🔄 Estado mudou para:', state);
});

// Desconexão
client.on('disconnected', reason => {
  log('⚠️ Desconectado por:', reason);
  // tentar reiniciar depois
  setTimeout(() => {
    log('🔁 Reinicializando o cliente...');
    client.initialize();
  }, 5000);
});

// Mensagens (com comandos etc)
client.on('message', async (msg) => {
  // igual ao código anterior, com try/catch e ensureChatParticipants
  // ...
  // para simplificar esse código de debug eu não replico tudo,
  // mas no seu código real mantenha os comandos, bloqueios, etc.
});

function scheduleGroupControl() {
  cron.schedule('0 22 * * *', async () => {
    log('🔒 Fechando grupos (22:00)...');
    try {
      const chats = await client.getChats().catch(e => { log('Erro getChats cron close:', e); return []; });
      for (const c of chats) {
        if (c.isGroup) {
          await closeGroup(c);
        }
      }
    } catch (e) {
      log('Erro fechar grupos cron:', e);
    }
  }, { timezone: 'America/Fortaleza' });

  cron.schedule('0 7 * * *', async () => {
    log('🔓 Abrindo grupos (07:00)...');
    try {
      const chats = await client.getChats().catch(e => { log('Erro getChats cron open:', e); return []; });
      for (const c of chats) {
        if (c.isGroup) {
          await openGroup(c);
        }
      }
    } catch (e) {
      log('Erro abrir grupos cron:', e);
    }
  }, { timezone: 'America/Fortaleza' });
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
    await chat.sendMessage('*🔓 Grupo aberto! Bom dia!*');
  } catch (e) {
    log('Erro abrir grupo:', e);
  }
}

// Endpoint para QR imagem
app.get('/qr-image', async (req, res) => {
  if (!lastQRCode) {
    log('Solicitado /qr-image, mas lastQRCode vazio');
    return res.status(404).send('QR não gerado');
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
    log('Erro gerar QR imagem:', e);
    res.status(500).send('Erro interno');
  }
});

// Página para ver QR no navegador
app.get('/', (req, res) => {
  res.send(`
    <html><body style="text-align:center; padding:30px; font-family:sans-serif;">
      <h1>Bot WhatsApp QR Debug</h1>
      <img id="qr" src="/qr-image" width="300" alt="QR Code" />
      <p>Atualiza a cada 5 segundos</p>
      <script>
        setInterval(() => {
          document.getElementById('qr').src = '/qr-image?' + new Date().getTime();
        }, 5000);
      </script>
    </body></html>
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  log('Servidor web rodando na porta', PORT);
});

client.initialize();
