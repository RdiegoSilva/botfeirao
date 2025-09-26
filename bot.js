const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurações específicas para Render
app.use(express.static('public'));

const DEBUG = true;
const WARNING_COOLDOWN_MS = 7000;

// Configuração do Puppeteer para Render
const client = new Client({
  authStrategy: new LocalAuth({ 
    clientId: 'bot-session',
    dataPath: './.wwebjs_auth' // Path relativo para Render
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
  }
});

const lastWarningAt = new Map();
let qrCodeData = null;
let qrCodeGenerated = false;
let isConnected = false;

function log(...args) { 
  if (DEBUG) console.log('[BOT]', new Date().toISOString(), ...args); 
}

// Middleware para evitar que o Render durma com requests periódicos
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connected: isConnected,
    timestamp: new Date().toISOString()
  });
});

// Rota principal otimizada para Render
app.get('/', async (req, res) => {
  try {
    if (!qrCodeData && !isConnected) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp Bot - Render</title>
            <meta charset="UTF-8">
            <meta http-equiv="refresh" content="10">
            <style>
                body {
                    font-family: Arial, sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    text-align: center;
                }
                .container {
                    background: rgba(255, 255, 255, 0.1);
                    padding: 30px;
                    border-radius: 15px;
                    backdrop-filter: blur(10px);
                    max-width: 90%;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                }
                .loading {
                    animation: pulse 1.5s infinite;
                }
                @keyframes pulse {
                    0% { opacity: 1; }
                    50% { opacity: 0.5; }
                    100% { opacity: 1; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>📱 WhatsApp Bot - Render</h1>
                <div class="loading">
                    <h2>🔄 Inicializando...</h2>
                    <p>Aguarde enquanto preparamos o QR Code.</p>
                    <p>Esta página será atualizada automaticamente.</p>
                </div>
                <p><small>Se esta mensagem persistir, verifique os logs no Render.</small></p>
            </div>
        </body>
        </html>
      `);
    }

    if (isConnected) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp Bot - Conectado</title>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: Arial, sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #00b09b 0%, #96c93d 100%);
                    color: white;
                    text-align: center;
                }
                .container {
                    background: rgba(255, 255, 255, 0.1);
                    padding: 30px;
                    border-radius: 15px;
                    backdrop-filter: blur(10px);
                }
                .success { font-size: 48px; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="success">✅</div>
                <h1>Conectado com Sucesso!</h1>
                <p>O bot está rodando no Render e pronto para uso.</p>
                <p><strong>Status:</strong> Online e funcionando</p>
            </div>
        </body>
        </html>
      `);
    }

    // Gerar QR Code
    const qrCodeImage = await qrcode.toDataURL(qrCodeData);
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>WhatsApp Bot - Render</title>
          <meta charset="UTF-8">
          <style>
              body {
                  font-family: Arial, sans-serif;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  text-align: center;
                  padding: 20px;
              }
              .container {
                  background: rgba(255, 255, 255, 0.1);
                  padding: 30px;
                  border-radius: 15px;
                  backdrop-filter: blur(10px);
                  max-width: 90%;
                  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
              }
              img {
                  border: 5px solid white;
                  border-radius: 10px;
                  max-width: 100%;
                  height: auto;
              }
              .instructions {
                  background: rgba(0, 0, 0, 0.3);
                  padding: 15px;
                  border-radius: 10px;
                  margin: 20px 0;
                  text-align: left;
              }
          </style>
      </head>
      <body>
          <div class="container">
              <h1>📱 WhatsApp Bot - Render</h1>
              <div>
                  <img src="${qrCodeImage}" alt="QR Code">
              </div>
              <div class="instructions">
                  <h3>📋 Como conectar:</h3>
                  <p>1. Abra o WhatsApp no celular</p>
                  <p>2. Toque em ⋮ (Menu) → Dispositivos vinculados → Vincular um dispositivo</p>
                  <p>3. Aponte a câmera para o QR Code acima</p>
                  <p><strong>⚠️ Importante:</strong> Mantenha esta aba aberta até conectar</p>
              </div>
              <p><a href="/health" style="color: #a0e7ff;">Verificar status da conexão</a></p>
          </div>
          <script>
              // Auto-refresh a cada 30 segundos se ainda não conectado
              setTimeout(() => location.reload(), 30000);
          </script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`
      <div style="font-family: Arial; text-align: center; padding: 50px;">
        <h1>❌ Erro</h1>
        <p>${error.message}</p>
        <p><a href="/">Tentar novamente</a></p>
      </div>
    `);
  }
});

// Event handlers do WhatsApp
client.on('qr', async (qr) => {
  log('QR Code recebido - gerando imagem para web...');
  qrCodeData = qr;
  qrCodeGenerated = true;
  isConnected = false;
  
  // Backup no terminal
  console.log('📲 QR Code para autenticação:');
  require('qrcode-terminal').generate(qr, { small: true });
});

client.on('ready', () => {
  log('✅ Cliente pronto e conectado!');
  qrCodeGenerated = false;
  isConnected = true;
  
  try {
    const info = client.info || {};
    BOT_ID = normalizeId(info.wid || info.me || info);
    log('BOT_ID determinado:', BOT_ID);
  } catch (e) {
    console.error('Não consegui determinar BOT_ID:', e);
  }
  scheduleGroupControl();
});

client.on('authenticated', () => {
  log('✅ Autenticado com sucesso!');
  isConnected = true;
});

client.on('auth_failure', (msg) => {
  log('❌ Falha na autenticação:', msg);
  isConnected = false;
});

client.on('disconnected', (reason) => {
  log('❌ Cliente desconectado:', reason);
  isConnected = false;
  qrCodeGenerated = true;
  
  // Tentar reconectar após 10 segundos
  setTimeout(() => {
    log('🔄 Tentando reconectar...');
    client.initialize();
  }, 10000);
});

// ... (as funções normalizeId, findParticipantById, ensureChatParticipants permanecem iguais)

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

// ... (restante do seu código original permanece igual)

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

// Inicialização otimizada para Render
const startServer = async () => {
  try {
    // Iniciar servidor
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      console.log(`📱 Acesse o QR Code via URL do Render`);
      console.log(`❤️  Health check: /health`);
    });

    // Inicializar WhatsApp com delay para garantir que o servidor está up
    setTimeout(() => {
      console.log('🔄 Inicializando cliente WhatsApp...');
      client.initialize();
    }, 2000);

  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
};

startServer();
