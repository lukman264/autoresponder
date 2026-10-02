const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const express = require('express');
const { downloadAuthStateFromFirebase, uploadAuthStateToFirebase } = require('./firebase-auth');

// Konfigurasi Environment Variables (PENTING UNTUK RENDER.COM)
const CLOUDFLARE_WEBHOOK = process.env.CLOUDFLARE_WEBHOOK || "https://livechat.sisitusdotcom.workers.dev/";
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || "https://mysisi-38440-default-rtdb.firebaseio.com";
const PORT = process.env.PORT || 3000;

let saveFirebaseInterval = null;

async function connectToWhatsApp() {
    console.log("Memulai Server WhatsApp Gateway Mandiri (Versi Cloud Render)...");
    
    // 1. Tarik Sesi Terakhir dari Firebase (Agar lolos restart Render)
    await downloadAuthStateFromFirebase(FIREBASE_DB_URL);
    
    // 2. Mulai Baileys dengan Sesi Tersebut
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }), 
        printQRInTerminal: true,
        browser: ['Mysisi Gateway', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    // 3. Simpan Sesi ke Firebase setiap 60 detik (Hanya jika ada perubahan)
    if (saveFirebaseInterval) clearInterval(saveFirebaseInterval);
    saveFirebaseInterval = setInterval(() => {
        uploadAuthStateToFirebase(FIREBASE_DB_URL);
    }, 60000);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("\nSCAN QR CODE DI BAWAH INI MENGGUNAKAN WHATSAPP ANDA:\n");
            console.log("Buka tab 'Logs' di Render.com untuk melihat QR ini lebih jelas.\n");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus! Menyambung kembali...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log("Perangkat dikeluarkan (Logged Out). Harap hapus folder 'auth_info_baileys' dan data di Firebase.");
            }
        } else if (connection === 'open') {
            console.log('✅ Gateway WhatsApp Mandiri Anda Berhasil Terhubung ke Server Meta!');
            // Upload segera saat berhasil login
            uploadAuthStateToFirebase(FIREBASE_DB_URL);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid.endsWith('@g.us')) return;

        const senderNumber = msg.key.remoteJid.split('@')[0];
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "";

        if (!textMessage.trim()) return;

        console.log(`[PESAN MASUK] Dari: ${senderNumber} | Pesan: ${textMessage}`);

        try {
            const fakeAutoResponderPayload = {
                appPackageName: "gateway.mandiri.mysisi",
                query: { sender: senderNumber, message: textMessage, isGroup: false }
            };

            const response = await axios.post(CLOUDFLARE_WEBHOOK, fakeAutoResponderPayload);
            const replies = response.data.replies;

            if (replies && Array.isArray(replies)) {
                for (let i = 0; i < replies.length; i++) {
                    const reply = replies[i];
                    if (reply.delay) {
                        const waitTime = (reply.delayMax) ? Math.floor(Math.random() * (reply.delayMax - reply.delay + 1)) + reply.delay : reply.delay;
                        await sock.sendPresenceUpdate('composing', msg.key.remoteJid);
                        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                        await sock.sendPresenceUpdate('paused', msg.key.remoteJid);
                    }
                    await sock.sendMessage(msg.key.remoteJid, { text: reply.message });
                    console.log(`[AI MEMBALAS] Ke: ${senderNumber}`);
                }
            }
        } catch (error) {
            console.error(`[ERROR] Gagal menghubungi Cloudflare:`, error.message);
        }
    });
}

// === EXPRESS WEB SERVER (Wajib untuk Render.com) ===
const app = express();
app.get('/', (req, res) => res.send('WhatsApp Gateway Aktif dan Berjalan 24 Jam!'));
app.listen(PORT, () => {
    console.log(`Server web port ${PORT} berjalan (Render Healthcheck OK)`);
    connectToWhatsApp();
});
