const fs = require('fs');
const path = require('path');
const axios = require('axios');

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

async function downloadAuthStateFromFirebase(firebaseDbUrl) {
    console.log('[Firebase] Mengambil sesi login terakhir dari Firebase...');
    try {
        const response = await axios.get(`${firebaseDbUrl}/wa-session.json`);
        const data = response.data;
        
        if (!data) {
            console.log('[Firebase] Tidak ada sesi tersimpan. Harus scan QR baru.');
            return;
        }

        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }

        for (const [encodedFileName, content] of Object.entries(data)) {
            const fileName = decodeURIComponent(encodedFileName);
            const filePath = path.join(AUTH_DIR, fileName);
            fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
        }
        console.log('[Firebase] Berhasil memulihkan sesi login dari Firebase!');
    } catch (error) {
        console.error('[Firebase] Gagal mengambil sesi:', error.message);
    }
}

async function uploadAuthStateToFirebase(firebaseDbUrl) {
    if (!fs.existsSync(AUTH_DIR)) return;
    
    try {
        const files = fs.readdirSync(AUTH_DIR);
        const sessionData = {};
        
        for (const file of files) {
            const filePath = path.join(AUTH_DIR, file);
            if (fs.statSync(filePath).isFile()) {
                const content = fs.readFileSync(filePath, 'utf-8');
                // Encode nama file agar aman disimpan sebagai key di Firebase RTDB
                const safeKey = encodeURIComponent(file).replace(/\./g, '%2E');
                sessionData[safeKey] = content;
            }
        }

        await axios.put(`${firebaseDbUrl}/wa-session.json`, sessionData);
    } catch (error) {
        console.error('[Firebase] Gagal menyimpan sesi ke awan:', error.message);
    }
}

module.exports = {
    downloadAuthStateFromFirebase,
    uploadAuthStateToFirebase,
    AUTH_DIR
};
