const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração melhorada do cliente
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
        ]
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    },
    restartOnAuthFail: true,
    takeoverOnConflict: true,
    takeoverTimeoutMs: 15000
});

let qrCodeImage = null;
let isConnected = false;
let statusMessage = '🔄 Iniciando...';
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Função para inicializar o cliente com tratamento de erro
function initializeWhatsApp() {
    try {
        console.log('🔧 Inicializando WhatsApp...');
        client.initialize();
    } catch (error) {
        console.error('❌ Erro na inicialização:', error);
        scheduleReconnect();
    }
}

// Função de reconexão
function scheduleReconnect() {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(1000 * reconnectAttempts, 30000); // Máximo 30 segundos
        
        console.log(`🔄 Tentativa ${reconnectAttempts} de reconexão em ${delay/1000} segundos...`);
        statusMessage = `🔄 Reconectando... Tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`;
        
        setTimeout(() => {
            initializeWhatsApp();
        }, delay);
    } else {
        console.error('❌ Máximo de tentativas de reconexão atingido');
        statusMessage = '❌ Erro de conexão. Reinicie o serviço.';
    }
}

// Rotas da aplicação
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>WhatsApp Bot</title>
        <meta charset="UTF-8">
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
                margin: 0;
            }
            .container {
                background: rgba(255, 255, 255, 0.1);
                padding: 40px;
                border-radius: 20px;
                backdrop-filter: blur(10px);
                text-align: center;
                max-width: 500px;
                width: 100%;
            }
            .status {
                font-size: 20px;
                margin: 20px 0;
                padding: 15px;
                border-radius: 10px;
                background: rgba(0, 0, 0, 0.3);
            }
            .connected { color: #4CAF50; }
            .waiting { color: #FF9800; }
            .error { color: #f44336; }
            .qrcode-container {
                margin: 30px 0;
                padding: 20px;
                background: rgba(255, 255, 255, 0.2);
                border-radius: 15px;
            }
            .qrcode-container img {
                max-width: 100%;
                height: auto;
                border: 5px solid white;
                border-radius: 10px;
            }
            .instructions {
                background: rgba(0, 0, 0, 0.3);
                padding: 20px;
                border-radius: 10px;
                margin: 20px 0;
                text-align: left;
            }
            button {
                background: white;
                color: #667eea;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 16px;
                margin: 5px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 WhatsApp Bot</h1>
            
            <div class="status" id="status">${statusMessage}</div>
            
            <div id="qrcode-container" class="qrcode-container">
                ${qrCodeImage ? `<img src="${qrCodeImage}" alt="QR Code">` : '<p>Gerando QR Code...</p>'}
            </div>
            
            <div class="instructions">
                <h3>📋 Solução de Problemas:</h3>
                <p>Se aparecer "não foi possível conectar":</p>
                <ol>
                    <li><strong>Feche todas as abas do WhatsApp Web</strong> no seu navegador</li>
                    <li><strong>Desconecte dispositivos antigos</strong> no WhatsApp → Dispositivos vinculados</li>
                    <li><strong>Aguarde 1 minuto</strong> e escaneie novamente</li>
                    <li><strong>Reinicie o serviço</strong> se persistir o erro</li>
                </ol>
            </div>
            
            <div>
                <button onclick="location.reload()">🔄 Atualizar</button>
                <button onclick="checkStatus()">📡 Status</button>
                <button onclick="restartService()">🔄 Reiniciar Serviço</button>
            </div>
        </div>
        
        <script>
            function checkStatus() {
                fetch('/status')
                    .then(response => response.json())
                    .then(data => {
                        const statusElement = document.getElementById('status');
                        const qrContainer = document.getElementById('qrcode-container');
                        
                        statusElement.innerHTML = data.status;
                        statusElement.className = 'status ' + (data.connected ? 'connected' : data.qrCode ? 'waiting' : 'error');
                        
                        if (data.qrCode) {
                            qrContainer.innerHTML = '<img src="' + data.qrCode + '" alt="QR Code">';
                        }
                    });
            }
            
            function restartService() {
                fetch('/restart', { method: 'POST' })
                    .then(response => response.json())
                    .then(data => {
                        alert('Serviço reiniciado! Aguarde...');
                        setTimeout(() => location.reload(), 3000);
                    });
            }
            
            setInterval(checkStatus, 3000);
            checkStatus();
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

app.get('/status', (req, res) => {
    res.json({
        connected: isConnected,
        qrCode: qrCodeImage,
        status: statusMessage,
        attempts: reconnectAttempts
    });
});

app.post('/restart', (req, res) => {
    console.log('🔄 Reiniciando serviço...');
    statusMessage = '🔄 Reiniciando...';
    qrCodeImage = null;
    isConnected = false;
    reconnectAttempts = 0;
    
    setTimeout(() => {
        initializeWhatsApp();
    }, 2000);
    
    res.json({ status: 'restarting' });
});

// Eventos do WhatsApp
client.on('qr', async (qr) => {
    console.log('📲 Novo QR Code gerado');
    statusMessage = '📱 QR Code disponível - Escaneie!';
    reconnectAttempts = 0; // Resetar tentativas
    
    try {
        qrCodeImage = await qrcode.toDataURL(qr);
        isConnected = false;
        
        // Mostrar no terminal também
        require('qrcode-terminal').generate(qr, { small: true });
    } catch (error) {
        console.error('❌ Erro ao gerar QR Code:', error);
    }
});

client.on('ready', () => {
    console.log('✅ Conectado com sucesso!');
    statusMessage = '✅ Conectado! Bot funcionando.';
    isConnected = true;
    qrCodeImage = null;
    reconnectAttempts = 0;
});

client.on('authenticated', () => {
    console.log('🔐 Autenticado');
    statusMessage = '🔐 Autenticado - Conectando...';
});

client.on('auth_failure', (msg) => {
    console.log('❌ Falha na autenticação:', msg);
    statusMessage = '❌ Falha na autenticação. Tentando novamente...';
    scheduleReconnect();
});

client.on('disconnected', (reason) => {
    console.log('🔌 Desconectado:', reason);
    statusMessage = '🔌 Desconectado. Reconectando...';
    isConnected = false;
    scheduleReconnect();
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Servidor iniciado na porta', PORT);
    console.log('📍 URL:', process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`);
    
    // Iniciar WhatsApp após 3 segundos
    setTimeout(() => {
        initializeWhatsApp();
    }, 3000);
});

// Mensagem de exemplo
client.on('message', message => {
    if (message.body === '!ping') {
        message.reply('pong');
    }
});
