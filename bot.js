const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do WhatsApp
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
    }
});

// Variáveis de estado
let qrCodeImage = null;
let isConnected = false;
let statusMessage = '🔄 Iniciando...';
let BOT_ID = null;

// Configurações
const DEBUG = true;
const WARNING_COOLDOWN_MS = 7000;
const lastWarningAt = new Map();

// Funções auxiliares
function log(...args) { 
    if (DEBUG) console.log('[BOT]', new Date().toLocaleString(), ...args); 
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
        const pid = normalizeId(p.id);
        return pid === idSerialized;
    });
}

async function ensureChatParticipants(chat) {
    try {
        if (!chat) return;
        if (chat.participants && chat.participants.length > 0) return;
        
        if (typeof chat.fetch === 'function') {
            log('Carregando participantes do chat...');
            await chat.fetch();
            if (chat.participants && chat.participants.length > 0) return;
        }
        
        const allChats = await client.getChats();
        const foundChat = allChats.find(c => normalizeId(c.id) === normalizeId(chat.id));
        if (foundChat && foundChat.participants && foundChat.participants.length > 0) {
            chat.participants = foundChat.participants;
            log('Participantes carregados via getChats()');
        }
    } catch (e) {
        console.error('Erro em ensureChatParticipants:', e);
    }
}

// Rotas da Web
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>WhatsApp Bot - Comandos Completos</title>
        <meta charset="UTF-8">
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                margin: 0;
                padding: 20px;
            }
            .container {
                max-width: 800px;
                margin: 0 auto;
                background: rgba(255,255,255,0.1);
                padding: 30px;
                border-radius: 15px;
                backdrop-filter: blur(10px);
            }
            .status {
                padding: 15px;
                border-radius: 10px;
                margin: 20px 0;
                text-align: center;
                font-size: 18px;
            }
            .connected { background: #4CAF50; }
            .waiting { background: #FF9800; }
            .error { background: #f44336; }
            .qrcode-container {
                text-align: center;
                margin: 30px 0;
            }
            .qrcode-container img {
                border: 5px solid white;
                border-radius: 10px;
                max-width: 300px;
            }
            .commands {
                background: rgba(0,0,0,0.3);
                padding: 20px;
                border-radius: 10px;
                margin: 20px 0;
            }
            .command-item {
                margin: 10px 0;
                padding: 10px;
                background: rgba(255,255,255,0.1);
                border-radius: 5px;
            }
            button {
                background: white;
                color: #667eea;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                margin: 5px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 WhatsApp Bot - Comandos Completos</h1>
            
            <div class="status" id="status">${statusMessage}</div>
            
            <div class="qrcode-container" id="qrcode-container">
                ${qrCodeImage ? `<img src="${qrCodeImage}" alt="QR Code">` : '<p>QR Code será gerado aqui...</p>'}
            </div>
            
            <div class="commands">
                <h2>📋 Comandos Disponíveis:</h2>
                
                <div class="command-item">
                    <strong>!link</strong> - Gera o link de convite do grupo
                </div>
                
                <div class="command-item">
                    <strong>Moderação Automática</strong> - Bloqueia links (TikTok, Kwai, Mercado Livre, etc)
                </div>
                
                <div class="command-item">
                    <strong>⏰ Horário Automático</strong> - Fecha grupos às 22:00 e abre às 07:00
                </div>
                
                <div class="command-item">
                    <strong>👮‍♂️ Moderação</strong> - Apenas admins podem enviar links
                </div>
                
                <div class="command-item">
                    <strong>🚫 Sites Bloqueados</strong>: TikTok, Kwai, Mercado Livre, Shopee, Instagram, wa.me
                </div>
            </div>
            
            <div style="text-align: center;">
                <button onclick="location.reload()">🔄 Atualizar</button>
                <button onclick="checkStatus()">📡 Verificar Status</button>
            </div>
        </div>
        
        <script>
            function checkStatus() {
                fetch('/status')
                    .then(r => r.json())
                    .then(data => {
                        const status = document.getElementById('status');
                        const qrContainer = document.getElementById('qrcode-container');
                        
                        status.innerHTML = data.status;
                        status.className = 'status ' + (data.connected ? 'connected' : data.qrCode ? 'waiting' : 'error');
                        
                        if (data.qrCode) {
                            qrContainer.innerHTML = '<img src="' + data.qrCode + '" alt="QR Code">';
                        } else if (data.connected) {
                            qrContainer.innerHTML = '<p>✅ Bot conectado e funcionando!</p>';
                        }
                    });
            }
            
            setInterval(checkStatus, 5000);
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
        botId: BOT_ID
    });
});

// Sistema de Moderação de Links
const prohibitedLinks = /(?:https?:\/\/\S+|www\.\S+|tiktok\.com|kwai\.com|mercadolivre\.com\.br|shopee\.com\.br|instagram\.com|wa\.me)/i;

// Funções de controle de grupo
const closeGroup = async (chat) => {
    try {
        await ensureChatParticipants(chat);
        const botParticipant = findParticipantById(chat, BOT_ID);
        
        if (!botParticipant || !botParticipant.isAdmin) {
            log('Bot não é admin, não pode fechar o grupo');
            return;
        }
        
        if (typeof chat.setMessagesAdminsOnly === 'function') {
            await chat.setMessagesAdminsOnly(true);
            log(`Grupo fechado: ${chat.name}`);
        }
        
        await chat.sendMessage('*🔒 Grupo fechado! Boa noite! 😴*');
    } catch (error) {
        console.error('Erro ao fechar grupo:', error);
    }
};

const openGroup = async (chat) => {
    try {
        await ensureChatParticipants(chat);
        const botParticipant = findParticipantById(chat, BOT_ID);
        
        if (!botParticipant || !botParticipant.isAdmin) {
            log('Bot não é admin, não pode abrir o grupo');
            return;
        }
        
        if (typeof chat.setMessagesAdminsOnly === 'function') {
            await chat.setMessagesAdminsOnly(false);
            log(`Grupo aberto: ${chat.name}`);
        }
        
        await chat.sendMessage('*🔓 Grupo aberto! Bom dia! ☀️*');
    } catch (error) {
        console.error('Erro ao abrir grupo:', error);
    }
};

// Agendamento automático
const scheduleGroupControl = () => {
    // Fechar grupos às 22:00
    cron.schedule('0 22 * * *', async () => {
        log('🕙 Fechando grupos (22:00)...');
        try {
            const chats = await client.getChats();
            const groupChats = chats.filter(chat => chat.isGroup);
            
            log(`Encontrados ${groupChats.length} grupos`);
            
            for (const chat of groupChats) {
                await closeGroup(chat);
            }
        } catch (error) {
            console.error('Erro ao fechar grupos:', error);
        }
    }, { timezone: 'America/Sao_Paulo' });

    // Abrir grupos às 07:00
    cron.schedule('0 7 * * *', async () => {
        log('🕖 Abrindo grupos (07:00)...');
        try {
            const chats = await client.getChats();
            const groupChats = chats.filter(chat => chat.isGroup);
            
            log(`Encontrados ${groupChats.length} grupos`);
            
            for (const chat of groupChats) {
                await openGroup(chat);
            }
        } catch (error) {
            console.error('Erro ao abrir grupos:', error);
        }
    }, { timezone: 'America/Sao_Paulo' });
    
    log('⏰ Agendamento configurado: Fechar 22:00, Abrir 07:00');
};

// Eventos do WhatsApp
client.on('qr', async (qr) => {
    console.log('📲 QR Code recebido');
    statusMessage = '📱 QR Code disponível - Escaneie agora!';
    
    try {
        qrCodeImage = await qrcode.toDataURL(qr);
        isConnected = false;
        
        // Mostrar QR Code no terminal também
        require('qrcode-terminal').generate(qr, { small: true });
    } catch (error) {
        console.error('Erro ao gerar QR Code:', error);
    }
});

client.on('ready', () => {
    console.log('✅ WhatsApp Bot conectado e pronto!');
    statusMessage = '✅ Conectado! Todos os comandos ativos.';
    isConnected = true;
    qrCodeImage = null;
    
    // Determinar BOT_ID
    try {
        const info = client.info || {};
        BOT_ID = normalizeId(info.wid || info.me || info);
        console.log('🤖 BOT_ID:', BOT_ID);
    } catch (error) {
        console.error('Erro ao determinar BOT_ID:', error);
    }
    
    // Iniciar agendamento automático
    scheduleGroupControl();
});

client.on('authenticated', () => {
    console.log('🔐 Autenticado com sucesso');
    statusMessage = '🔐 Autenticado - Conectando...';
});

client.on('auth_failure', (msg) => {
    console.log('❌ Falha na autenticação:', msg);
    statusMessage = '❌ Falha na autenticação';
});

client.on('disconnected', (reason) => {
    console.log('🔌 Desconectado:', reason);
    statusMessage = '🔌 Desconectado';
    isConnected = false;
});

// Sistema de mensagens e comandos
client.on('message', async (msg) => {
    try {
        // Ignorar mensagens que não são de grupos
        const chat = await msg.getChat();
        if (!chat.isGroup) return;

        await ensureChatParticipants(chat);
        
        // Obter informações do remetente
        const senderContact = await msg.getContact();
        const SENDER_ID = normalizeId(msg.author || senderContact.id);
        
        const senderParticipant = findParticipantById(chat, SENDER_ID);
        const senderIsAdmin = Boolean(senderParticipant && senderParticipant.isAdmin);
        
        // Determinar BOT_ID se ainda não definido
        if (!BOT_ID && client.info) {
            BOT_ID = normalizeId(client.info.wid);
        }
        
        const botParticipant = findParticipantById(chat, BOT_ID);
        const botIsAdmin = Boolean(botParticipant && botParticipant.isAdmin);
        
        const text = (msg.body || '').toString().trim();

        // COMANDO: !link
        if (text.toLowerCase() === '!link') {
            log(`Comando !link solicitado por ${senderContact.name || SENDER_ID}`);
            
            try {
                const inviteCode = await chat.getInviteCode();
                const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
                await chat.sendMessage(`🔗 Link do grupo: ${inviteLink}`);
                log('Link do grupo enviado com sucesso');
            } catch (error) {
                console.error('Erro ao gerar link:', error);
                await chat.sendMessage('*❌ Não consegui obter o link. Verifique se sou admin do grupo.*');
            }
            return;
        }

        // MODERAÇÃO: Bloquear links proibidos
        if (prohibitedLinks.test(text)) {
            // Admins podem enviar links
            if (senderIsAdmin) {
                log(`Admin ${senderContact.name} enviou link permitido`);
                return;
            }
            
            // Bot precisa ser admin para moderar
            if (!botIsAdmin) {
                log('Link detectado mas bot não é admin, ignorando');
                return;
            }

            const chatIdKey = normalizeId(chat.id);
            const lastWarning = lastWarningAt.get(chatIdKey) || 0;
            
            // Evitar spam de avisos
            if (Date.now() - lastWarning < WARNING_COOLDOWN_MS) {
                try {
                    await msg.delete(true);
                    log('Mensagem com link deletada (cooldown)');
                } catch (e) {}
                return;
            }

            try {
                // Deletar mensagem com link
                await msg.delete(true);
                log('Mensagem com link deletada');
                
                // Enviar aviso
                const mention = senderContact ? [senderContact] : [];
                await chat.sendMessage(
                    `⚠️ @${senderContact.number} — *Proibido enviar links! ❌*\n` +
                    `Sites bloqueados: TikTok, Kwai, Mercado Livre, Shopee, Instagram, etc.`,
                    { mentions: mention }
                );
                
                lastWarningAt.set(chatIdKey, Date.now());
                log(`Aviso enviado para ${senderContact.name}`);
                
            } catch (error) {
                console.error('Erro na moderação:', error);
            }
        }

    } catch (error) {
        console.error('Erro ao processar mensagem:', error);
    }
});

// Inicialização
app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Servidor web rodando na porta:', PORT);
    console.log('📍 URL:', process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`);
    console.log('📋 Comandos ativos: !link, moderação de links, horário automático');
    
    // Iniciar WhatsApp
    setTimeout(() => {
        client.initialize();
    }, 2000);
});

// Tratamento de erros globais
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada:', reason);
});
