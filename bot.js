const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'bot-render'
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
            '--disable-gpu'
        ]
    }
});

// Variáveis de estado
let qrCodeImage = null;
let isConnected = false;
let statusMessage = '🔄 Iniciando...';

// Rota principal - SIMPLIFICADA E FUNCIONAL
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>WhatsApp Bot</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
            }
            .container {
                background: rgba(255, 255, 255, 0.1);
                padding: 40px;
                border-radius: 20px;
                backdrop-filter: blur(10px);
                text-align: center;
                max-width: 500px;
                width: 100%;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            }
            h1 {
                margin-bottom: 20px;
                font-size: 28px;
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
            .loading { color: #2196F3; }
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
            .instructions ol {
                margin-left: 20px;
                margin-top: 10px;
            }
            .instructions li {
                margin-bottom: 10px;
            }
            .url-info {
                background: rgba(255, 255, 255, 0.2);
                padding: 15px;
                border-radius: 10px;
                margin: 15px 0;
                word-break: break-all;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 WhatsApp Bot</h1>
            
            <div class="url-info">
                <strong>🌐 URL do Bot:</strong><br>
                ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}
            </div>
            
            <div class="status" id="status">${statusMessage}</div>
            
            <div id="qrcode-container" class="qrcode-container">
                ${qrCodeImage ? `<img src="${qrCodeImage}" alt="QR Code">` : '<p>QR Code será gerado aqui...</p>'}
            </div>
            
            <div class="instructions">
                <h3>📋 Como conectar:</h3>
                <ol>
                    <li>Abra o WhatsApp no celular</li>
                    <li>Toque em ⋮ (Menu) → Dispositivos vinculados → Vincular um dispositivo</li>
                    <li>Aponte a câmera para o QR Code acima</li>
                    <li>Aguarde a confirmação de conexão</li>
                </ol>
            </div>
            
            <div style="margin-top: 20px;">
                <button onclick="location.reload()" style="
                    background: white;
                    color: #667eea;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 16px;
                    margin: 5px;
                ">🔄 Atualizar Página</button>
                
                <button onclick="checkStatus()" style="
                    background: #4CAF50;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 16px;
                    margin: 5px;
                ">📡 Verificar Status</button>
            </div>
        </div>
        
        <script>
            function checkStatus() {
                fetch('/status')
                    .then(response => response.json())
                    .then(data => {
                        const statusElement = document.getElementById('status');
                        const qrContainer = document.getElementById('qrcode-container');
                        
                        // Atualizar status
                        if (data.connected) {
                            statusElement.innerHTML = '✅ <strong>CONECTADO!</strong> Bot está funcionando.';
                            statusElement.className = 'status connected';
                            qrContainer.innerHTML = '<p>✅ Conectado com sucesso!</p>';
                        } else if (data.qrCode) {
                            statusElement.innerHTML = '📱 <strong>QR CODE DISPONÍVEL - Escaneie agora!</strong>';
                            statusElement.className = 'status waiting';
                            qrContainer.innerHTML = '<img src="' + data.qrCode + '" alt="QR Code">';
                        } else {
                            statusElement.innerHTML = '🔄 <strong>Aguardando QR Code...</strong>';
                            statusElement.className = 'status loading';
                        }
                    })
                    .catch(error => {
                        console.error('Erro:', error);
                    });
            }
            
            // Verificar status a cada 5 segundos
            setInterval(checkStatus, 5000);
            
            // Verificar status ao carregar a página
            document.addEventListener('DOMContentLoaded', checkStatus);
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

// Rota de status
app.get('/status', (req, res) => {
    res.json({
        connected: isConnected,
        qrCode: qrCodeImage,
        status: statusMessage,
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        connected: isConnected,
        service: 'whatsapp-bot' 
    });
});

// Eventos do WhatsApp
client.on('qr', async (qr) => {
    console.log('📲 QR Code recebido - gerando imagem...');
    statusMessage = '📱 QR Code gerado - Escaneie!';
    
    try {
        // Gerar QR Code como Data URL
        qrCodeImage = await qrcode.toDataURL(qr);
        isConnected = false;
        console.log('✅ QR Code imagem gerada com sucesso!');
        
        // Mostrar QR Code no terminal também
        const qrTerminal = require('qrcode-terminal');
        qrTerminal.generate(qr, { small: true });
    } catch (error) {
        console.error('❌ Erro ao gerar QR Code:', error);
        statusMessage = '❌ Erro ao gerar QR Code';
    }
});

client.on('ready', () => {
    console.log('✅ WhatsApp Bot conectado e pronto!');
    statusMessage = '✅ Conectado! Bot funcionando.';
    isConnected = true;
    qrCodeImage = null;
});

client.on('authenticated', () => {
    console.log('🔐 Autenticado com sucesso');
    statusMessage = '🔐 Autenticado - Conectando...';
});

client.on('auth_failure', (msg) => {
    console.log('❌ Falha na autenticação:', msg);
    statusMessage = '❌ Falha na autenticação';
    isConnected = false;
});

client.on('disconnected', (reason) => {
    console.log('🔌 Desconectado:', reason);
    statusMessage = '🔌 Desconectado - Reconectando...';
    isConnected = false;
    
    // Reconectar após 5 segundos
    setTimeout(() => {
        console.log('🔄 Tentando reconectar...');
        client.initialize();
    }, 5000);
});

// Inicialização
console.log('🚀 Iniciando WhatsApp Bot...');
console.log('📦 Dependências carregadas');

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log('🌐 Servidor web rodando na porta:', PORT);
    console.log('📍 URL local: http://localhost:' + PORT);
    if (process.env.RENDER_EXTERNAL_URL) {
        console.log('🌐 URL pública:', process.env.RENDER_EXTERNAL_URL);
    }
    
    // Iniciar WhatsApp após o servidor estar rodando
    setTimeout(() => {
        console.log('🔧 Inicializando WhatsApp Web...');
        client.initialize();
    }, 2000);
});

// Mensagem simples para teste
client.on('message', message => {
    if (message.body === '!ping') {
        message.reply('pong');
    }
});

// Log de erro global
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada:', reason);
});
