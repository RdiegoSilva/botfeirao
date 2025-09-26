const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração específica para Render
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

console.log('🚀 Iniciando WhatsApp Bot...');
console.log('📦 Versão do Node:', process.version);

// Configuração otimizada para Render
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'bot-render',
    dataPath: './.wwebjs_auth'
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
      '--disable-gpu',
      '--single-process'
    ],
    executablePath: process.env.CHROMIUM_PATH || undefined
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
  }
});

let qrCodeData = null;
let isConnected = false;
let clientInitialized = false;

// Middleware básico
app.use(express.json());

// Rota principal simplificada
app.get('/', async (req, res) => {
  try {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>WhatsApp Bot - Render</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            .container {
                background: rgba(255,255,255,0.1);
                padding: 30px;
                border-radius: 15px;
                backdrop-filter: blur(10px);
                text-align: center;
                max-width: 90%;
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            }
            .status {
                font-size: 24px;
                margin: 20px 0;
            }
            .connected { color: #4CAF50; }
            .disconnected { color: #ff9800; }
            .qrcode {
                margin: 20px 0;
                padding: 20px;
                background: rgba(0,0,0,0.2);
                border-radius: 10px;
            }
            .info {
                background: rgba(0,0,0,0.3);
                padding: 15px;
                border-radius: 10px;
                margin: 15px 0;
                text-align: left;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 WhatsApp Bot</h1>
            <div class="info">
                <strong>URL:</strong> ${PUBLIC_URL}<br>
                <strong>Status:</strong> <span id="statusText">Carregando...</span>
            </div>
            
            <div id="content">
                <div id="loading">🔄 Carregando...</div>
                <div id="qrcode" style="display: none;"></div>
                <div id="connected" style="display: none;"></div>
            </div>
            
            <div class="info">
                <h3>📋 Instruções:</h3>
                <p>1. WhatsApp → Menu → Dispositivos vinculados</p>
                <p>2. Escaneie o QR Code</p>
                <p>3. Aguarde a confirmação</p>
            </div>
        </div>
        
        <script>
            function updateStatus(connected, qrCode) {
                const statusText = document.getElementById('statusText');
                const loading = document.getElementById('loading');
                const qrcodeDiv = document.getElementById('qrcode');
                const connectedDiv = document.getElementById('connected');
                
                if (connected) {
                    statusText.innerHTML = '<span class="connected">✅ CONECTADO</span>';
                    loading.style.display = 'none';
                    qrcodeDiv.style.display = 'none';
                    connectedDiv.style.display = 'block';
                    connectedDiv.innerHTML = '<div class="status connected">🤖 Bot está funcionando!</div>';
                } else if (qrCode) {
                    statusText.innerHTML = '<span class="disconnected">⏳ AGUARDANDO QR CODE</span>';
                    loading.style.display = 'none';
                    qrcodeDiv.style.display = 'block';
                    qrcodeDiv.innerHTML = '<div class="qrcode"><img src="' + qrCode + '" alt="QR Code" style="max-width: 300px; border: 5px solid white; border-radius: 10px;"></div>';
                } else {
                    statusText.innerHTML = '<span class="disconnected">🔄 INICIANDO...</span>';
                }
            }
            
            // Verificar status a cada 3 segundos
            async function checkStatus() {
                try {
                    const response = await fetch('/status');
                    const data = await response.json();
                    updateStatus(data.connected, data.qrCode);
                } catch (error) {
                    console.log('Erro ao verificar status:', error);
                }
            }
            
            // Verificar status inicial
            checkStatus();
            
            // Verificar a cada 3 segundos
            setInterval(checkStatus, 3000);
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
  } catch (error) {
    res.status(500).send(`Erro: ${error.message}`);
  }
});

// Rota de status
app.get('/status', (req, res) => {
  res.json({
    connected: isConnected,
    qrCode: qrCodeData ? `/qrimage` : null,
    url: PUBLIC_URL,
    timestamp: new Date().toISOString()
  });
});

// Rota para imagem do QR Code
app.get('/qrimage', async (req, res) => {
  try {
    if (!qrCodeData) {
      return res.status(404).send('QR Code não disponível');
    }
    
    const qrImage = await qrcode.toBuffer(qrCodeData);
    res.setHeader('Content-Type', 'image/png');
    res.send(qrImage);
  } catch (error) {
    res.status(500).send('Erro ao gerar QR Code');
  }
});

// Health check para evitar sleeping
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'whatsapp-bot',
    connected: isConnected,
    timestamp: new Date().toISOString() 
  });
});

// Event handlers do WhatsApp
client.on('qr', async (qr) => {
  console.log('📲 QR Code recebido');
  qrCodeData = qr;
  isConnected = false;
  
  // Gerar QR Code no terminal também (backup)
  try {
    const qrTerminal = require('qrcode-terminal');
    qrTerminal.generate(qr, { small: true });
  } catch (error) {
    console.log('QR Code terminal não disponível');
  }
});

client.on('ready', () => {
  console.log('✅ WhatsApp Bot conectado e pronto!');
  console.log('🌐 URL:', PUBLIC_URL);
  isConnected = true;
  qrCodeData = null;
});

client.on('authenticated', () => {
  console.log('🔐 Autenticado com sucesso');
  isConnected = true;
});

client.on('auth_failure', (msg) => {
  console.log('❌ Falha na autenticação:', msg);
  isConnected = false;
});

client.on('disconnected', (reason) => {
  console.log('🔌 Desconectado:', reason);
  isConnected = false;
  
  // Tentar reconectar após 10 segundos
  setTimeout(() => {
    console.log('🔄 Tentando reconectar...');
    client.initialize();
  }, 10000);
});

client.on('message', async (msg) => {
  // Seu código de mensagens aqui (mantenha o original)
  try {
    const chat = await msg.getChat();
    if (!chat || !chat.isGroup) return;

    const text = (msg.body || '').toString().trim().toLowerCase();

    // Comando !link
    if (text === '!link') {
      try {
        const inviteCode = await chat.getInviteCode();
        const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
        await chat.sendMessage(`🔗 Link do grupo: ${inviteLink}`);
      } catch (err) {
        await chat.sendMessage('*❌ Não consegui obter o link. Verifique se sou admin do grupo.*');
      }
      return;
    }

    // Detecção de links proibidos (mantenha sua lógica original)
    const prohibitedLinks = /(?:https?:\/\/\S+|www\.\S+|tiktok\.com|kwai\.com|mercadolivre\.com|shopee\.com|instagram\.com|wa\.me)/i;
    
    if (prohibitedLinks.test(text)) {
      // Sua lógica original de moderação aqui
    }

  } catch (err) {
    console.error('Erro na mensagem:', err);
  }
});

// Inicialização segura
async function initializeBot() {
  try {
    console.log('🔧 Inicializando servidor web...');
    
    // Iniciar servidor
    app.listen(PORT, '0.0.0.0', () => {
      console.log('🌐 Servidor rodando na porta:', PORT);
      console.log('📱 URL do QR Code:', PUBLIC_URL);
      console.log('❤️  Health check:', `${PUBLIC_URL}/health`);
    });

    // Aguardar um pouco antes de iniciar o WhatsApp
    setTimeout(() => {
      console.log('🔧 Inicializando cliente WhatsApp...');
      client.initialize();
      clientInitialized = true;
    }, 3000);

  } catch (error) {
    console.error('❌ Erro na inicialização:', error);
    process.exit(1);
  }
}

// Inicializar o bot
initializeBot();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Desligando bot...');
  client.destroy();
  process.exit(0);
});
