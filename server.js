const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { processQuote: processCopilot, sendQuoteConfirmationEmail } = require('./copilot');

const PORT = 3000;

// Discord webhook for notifications (Chris's DM or a channel)
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || '';
const DISCORD_USER_ID = '402602300184461322'; // Chris's Discord ID for mentions

// Store quote requests
const QUOTES_FILE = path.join(__dirname, 'quote-requests.json');
const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');
const PHOTOS_DIR = path.join(__dirname, 'photos');

// Ensure directories exist
[SNAPSHOTS_DIR, PHOTOS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

function loadQuotes() {
    try {
        if (fs.existsSync(QUOTES_FILE)) {
            return JSON.parse(fs.readFileSync(QUOTES_FILE, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function saveSnapshot(quote) {
    if (!quote.snapshot) return null;
    
    const date = new Date().toISOString().split('T')[0];
    const dateDir = path.join(SNAPSHOTS_DIR, date);
    if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
    }
    
    const cleanEmail = (quote.email || 'unknown').toLowerCase().replace(/[^a-z0-9@.-]/g, '_');
    const filename = `${cleanEmail}_${quote.submissionId || Date.now()}.png`;
    const filepath = path.join(dateDir, filename);
    
    const base64Data = quote.snapshot.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(filepath, base64Data, 'base64');
    
    console.log(`   📸 Snapshot saved: ${filepath}`);
    return filepath;
}

function savePhotos(quote) {
    if (!quote.photos || quote.photos.length === 0) return [];
    
    const date = new Date().toISOString().split('T')[0];
    const cleanEmail = (quote.email || 'unknown').toLowerCase().replace(/[^a-z0-9@.-]/g, '_');
    const dateDir = path.join(PHOTOS_DIR, date, cleanEmail + '_' + (quote.submissionId || Date.now()));
    
    if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
    }
    
    const savedPaths = [];
    quote.photos.forEach((photo, i) => {
        const ext = photo.type === 'image/png' ? 'png' : 'jpg';
        const filename = `photo_${i + 1}.${ext}`;
        const filepath = path.join(dateDir, filename);
        
        const base64Data = photo.data.replace(/^data:image\/[a-z]+;base64,/, '');
        fs.writeFileSync(filepath, base64Data, 'base64');
        savedPaths.push(filepath);
    });
    
    console.log(`   📷 ${savedPaths.length} photos saved to: ${dateDir}`);
    return savedPaths;
}

// Clawdbot Gateway config
const CLAWDBOT_GATEWAY_URL = 'http://localhost:18789';
const CLAWDBOT_TOKEN = '0bcbdde4bf9371b723121283de47c518023c60dcdbee7416';

async function wakeClawdbot(message) {
    return new Promise((resolve) => {
        const data = JSON.stringify({ text: message });
        const url = new URL('/api/cron/wake', CLAWDBOT_GATEWAY_URL);
        
        const req = http.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CLAWDBOT_TOKEN}`,
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log(`   🤖 Clawdbot wake: ${res.statusCode === 200 ? 'SUCCESS' : 'FAILED'}`);
                resolve(res.statusCode === 200);
            });
        });
        
        req.on('error', (e) => {
            console.log(`   ⚠️  Clawdbot wake error: ${e.message}`);
            resolve(false);
        });
        
        req.write(data);
        req.end();
    });
}

async function sendDiscordNotification(quote, snapshotPath, photoPaths, copilotResult) {
    // Save notification for Clawdbot to process
    const notificationFile = path.join(__dirname, 'pending-notifications.json');
    
    const notification = {
        timestamp: new Date().toISOString(),
        quote: {
            name: quote.name,
            email: quote.email,
            phone: quote.phone,
            address: quote.address,
            services: quote.services,
            turfSqft: quote.turfSqft,
            mulchSqft: quote.mulchSqft,
            mulchCuFt: quote.mulchCuFt,
            notes: quote.notes
        },
        snapshotPath,
        photoPaths,
        copilot: copilotResult ? {
            customerId: copilotResult.customer?.customerId,
            propertyId: copilotResult.property?.propertyId,
            success: copilotResult.customer?.success
        } : null,
        notified: false
    };
    
    let notifications = [];
    try {
        if (fs.existsSync(notificationFile)) {
            notifications = JSON.parse(fs.readFileSync(notificationFile, 'utf8'));
        }
    } catch (e) {}
    
    notifications.push(notification);
    fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2));
    console.log(`   🔔 Notification queued`);
    
    // Wake Clawdbot to process the new quote request immediately
    const wakeMessage = `NEW QUOTE REQUEST: ${quote.name} at ${quote.address} wants ${(quote.services || []).join(', ')}. Check pending-notifications and run the estimate workflow.`;
    await wakeClawdbot(wakeMessage);
}

async function saveQuote(quote) {
    const snapshotPath = saveSnapshot(quote);
    const photoPaths = savePhotos(quote);
    
    // Process with Copilot CRM
    let copilotResult = null;
    try {
        copilotResult = await processCopilot(quote);
        
        // Send confirmation email if customer was created successfully
        if (copilotResult?.customer?.success && copilotResult.customer.customerId) {
            console.log('   📧 Sending confirmation email to customer...');
            const emailResult = await sendQuoteConfirmationEmail(
                copilotResult.customer.customerId,
                quote
            );
            if (emailResult.success) {
                console.log('   ✅ Confirmation email sent!');
                copilotResult.emailSent = true;
            } else {
                console.log(`   ⚠️  Email failed: ${emailResult.error}`);
                copilotResult.emailSent = false;
                copilotResult.emailError = emailResult.error;
            }
        }
    } catch (e) {
        console.error('   ❌ Copilot error:', e.message);
    }
    
    // Queue Discord notification
    sendDiscordNotification(quote, snapshotPath, photoPaths, copilotResult);
    
    // Remove large data from quote
    const quoteData = { ...quote };
    delete quoteData.snapshot;
    delete quoteData.photos;
    if (snapshotPath) quoteData.snapshotPath = snapshotPath;
    if (photoPaths.length > 0) quoteData.photoPaths = photoPaths;
    if (copilotResult?.customer?.customerId) {
        quoteData.copilotCustomerId = copilotResult.customer.customerId;
    }
    if (copilotResult?.property?.propertyId) {
        quoteData.copilotPropertyId = copilotResult.property.propertyId;
    }
    
    const quotes = loadQuotes();
    quotes.push(quoteData);
    fs.writeFileSync(QUOTES_FILE, JSON.stringify(quotes, null, 2));
    return { count: quotes.length, copilotResult };
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    const url = req.url.split('?')[0];
    
    // Serve index
    if (url === '/' || url === '/index.html') {
        const content = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
        res.writeHead(200, { 
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache'
        });
        res.end(content);
        return;
    }
    
    // API: Save quote request
    if (url === '/api/quote-request' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const quote = JSON.parse(body);
                const result = await saveQuote(quote);
                
                const serviceNames = {
                    'mowing': 'Weekly Mowing',
                    'aeration': 'Aeration',
                    'overseeding': 'Overseeding',
                    'fertilizer': 'Fertilization',
                    'weed_control': 'Weed Control',
                    'mulch': 'Mulch Install',
                    'cleanup': 'Cleanup',
                    'bush_trimming': 'Bush Trimming',
                    'snow': 'Snow Removal',
                    'in_person': 'In-Person Estimate'
                };
                
                console.log('\n🎉 NEW QUOTE REQUEST:');
                console.log(`   Name: ${quote.name}`);
                console.log(`   Email: ${quote.email}`);
                console.log(`   Phone: ${quote.phone}`);
                console.log(`   Address: ${quote.address}`);
                console.log(`   Services: ${(quote.services || []).map(s => serviceNames[s] || s).join(', ')}`);
                if (quote.turfSqft) console.log(`   Lawn: ${quote.turfSqft} sq ft`);
                if (quote.mulchSqft) console.log(`   Mulch: ${quote.mulchSqft} sq ft (${quote.mulchCuFt} cu ft)`);
                if (quote.photos?.length) console.log(`   Photos: ${quote.photos.length} uploaded`);
                console.log(`   Notes: ${quote.notes || 'None'}`);
                console.log(`   Total requests: ${result.count}\n`);
                
                // Log Copilot result
                if (result.copilotResult?.customer?.success) {
                    console.log(`   🔗 Copilot Customer ID: ${result.copilotResult.customer.customerId}`);
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    total: result.count,
                    copilotCustomerId: result.copilotResult?.customer?.customerId
                }));
            } catch (e) {
                console.error('Error saving quote:', e);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }
    
    // API: Get quotes
    if (url === '/api/quotes' && req.method === 'GET') {
        const quotes = loadQuotes();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(quotes));
        return;
    }
    
    // API: Get pending notifications (for Clawdbot to check)
    if (url === '/api/pending-notifications' && req.method === 'GET') {
        const notificationFile = path.join(__dirname, 'pending-notifications.json');
        let notifications = [];
        try {
            if (fs.existsSync(notificationFile)) {
                notifications = JSON.parse(fs.readFileSync(notificationFile, 'utf8'));
                notifications = notifications.filter(n => !n.notified);
            }
        } catch (e) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(notifications));
        return;
    }
    
    // API: Mark notification as sent
    if (url === '/api/mark-notified' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { timestamp } = JSON.parse(body);
                const notificationFile = path.join(__dirname, 'pending-notifications.json');
                let notifications = [];
                if (fs.existsSync(notificationFile)) {
                    notifications = JSON.parse(fs.readFileSync(notificationFile, 'utf8'));
                    notifications = notifications.map(n => 
                        n.timestamp === timestamp ? { ...n, notified: true } : n
                    );
                    fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }
    
    // API: List snapshots
    if (url === '/api/snapshots' && req.method === 'GET') {
        try {
            const snapshots = [];
            if (fs.existsSync(SNAPSHOTS_DIR)) {
                const dates = fs.readdirSync(SNAPSHOTS_DIR).filter(f => 
                    fs.statSync(path.join(SNAPSHOTS_DIR, f)).isDirectory()
                ).sort().reverse();
                
                for (const date of dates) {
                    const dateDir = path.join(SNAPSHOTS_DIR, date);
                    const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.png'));
                    for (const file of files) {
                        snapshots.push({
                            date,
                            filename: file,
                            path: `${date}/${file}`,
                            email: file.split('_')[0].replace(/_/g, '.')
                        });
                    }
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(snapshots));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }
    
    // API: Get snapshot image
    if (url.startsWith('/api/snapshot/') && req.method === 'GET') {
        const filepath = decodeURIComponent(url.replace('/api/snapshot/', ''));
        const fullPath = path.join(SNAPSHOTS_DIR, filepath);
        
        if (fs.existsSync(fullPath) && fullPath.startsWith(SNAPSHOTS_DIR)) {
            const content = fs.readFileSync(fullPath);
            res.writeHead(200, { 
                'Content-Type': 'image/png',
                'Content-Disposition': `inline; filename="${path.basename(fullPath)}"`
            });
            res.end(content);
            return;
        }
        
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Snapshot not found' }));
        return;
    }
    
    // API: Get photo
    if (url.startsWith('/api/photo/') && req.method === 'GET') {
        const filepath = decodeURIComponent(url.replace('/api/photo/', ''));
        const fullPath = path.join(PHOTOS_DIR, filepath);
        
        if (fs.existsSync(fullPath) && fullPath.startsWith(PHOTOS_DIR)) {
            const content = fs.readFileSync(fullPath);
            const ext = path.extname(fullPath).toLowerCase();
            const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Content-Disposition': `inline; filename="${path.basename(fullPath)}"`
            });
            res.end(content);
            return;
        }
        
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Photo not found' }));
        return;
    }
    
    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
🌿 No Mow Worries Quote Widget
==============================
Running at http://localhost:${PORT}

Share this link with customers to get instant quotes!
Press Ctrl+C to stop.
    `);
});
