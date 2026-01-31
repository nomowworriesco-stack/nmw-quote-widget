const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { processQuote: processCopilot, sendQuoteConfirmationEmail } = require('./copilot');
const { sendQuoteNotification } = require('./email-notify');

const PORT = 3000;
const GOOGLE_MAPS_API_KEY = 'AIzaSyDutgNGfggQz618lCQZkBVkMZkE0xtDRKQ';

/**
 * Encode polyline using Google's algorithm
 * @param {Array} coords - Array of {lat, lng} objects
 * @returns {string} - Encoded polyline string
 */
function encodePolyline(coords) {
    let encoded = '';
    let prevLat = 0;
    let prevLng = 0;
    
    for (const coord of coords) {
        const lat = Math.round(coord.lat * 1e5);
        const lng = Math.round(coord.lng * 1e5);
        
        encoded += encodeSignedNumber(lat - prevLat);
        encoded += encodeSignedNumber(lng - prevLng);
        
        prevLat = lat;
        prevLng = lng;
    }
    
    return encoded;
}

function encodeSignedNumber(num) {
    let sgn_num = num << 1;
    if (num < 0) {
        sgn_num = ~sgn_num;
    }
    return encodeNumber(sgn_num);
}

function encodeNumber(num) {
    let encoded = '';
    while (num >= 0x20) {
        encoded += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
        num >>= 5;
    }
    encoded += String.fromCharCode(num + 63);
    return encoded;
}

/**
 * Generate a static map image from Google Maps API
 * @param {string} address - Full address string
 * @param {object} mapCenter - {lat, lng} optional center override
 * @param {Array} polygons - Optional array of polygon data with coords
 * @returns {Promise<Buffer|null>} - Image buffer or null on failure
 */
async function generateStaticMap(address, mapCenter = null, polygons = null) {
    return new Promise((resolve) => {
        // Build Static Maps URL
        const params = new URLSearchParams({
            size: '600x400',
            maptype: 'satellite',
            key: GOOGLE_MAPS_API_KEY
        });
        
        // Calculate center and zoom from polygons if available
        let centerLat = null;
        let centerLng = null;
        let zoomLevel = 19; // Default zoom
        
        console.log(`   🗺️  generateStaticMap called:`);
        console.log(`      - address: ${address}`);
        console.log(`      - mapCenter: ${mapCenter ? JSON.stringify(mapCenter) : 'null'}`);
        console.log(`      - polygons: ${polygons ? polygons.length : 'null/undefined'}`);
        
        if (polygons && polygons.length > 0) {
            // Calculate center of all polygon points
            let allLats = [];
            let allLngs = [];
            for (const poly of polygons) {
                console.log(`      - Polygon: type=${poly.type}, sqft=${poly.sqft}, coords=${poly.coords ? poly.coords.length : 0}`);
                if (poly.coords && poly.coords.length >= 3) {
                    for (const coord of poly.coords) {
                        allLats.push(coord.lat);
                        allLngs.push(coord.lng);
                    }
                }
            }
            console.log(`      - Total coord points collected: ${allLats.length}`);
            if (allLats.length > 0) {
                const minLat = Math.min(...allLats);
                const maxLat = Math.max(...allLats);
                const minLng = Math.min(...allLngs);
                const maxLng = Math.max(...allLngs);
                
                // Calculate actual center of the polygon bounds
                centerLat = (minLat + maxLat) / 2;
                centerLng = (minLng + maxLng) / 2;
                
                // Calculate polygon span to determine zoom
                const latSpan = maxLat - minLat;
                const lngSpan = maxLng - minLng;
                const maxSpan = Math.max(latSpan, lngSpan);
                
                // Adjust zoom based on polygon size:
                // Very small (<0.0003 span) = zoom 20
                // Small (0.0003-0.001) = zoom 19
                // Medium (0.001-0.003) = zoom 18
                // Large (>0.003) = zoom 17
                if (maxSpan < 0.0003) {
                    zoomLevel = 20;
                } else if (maxSpan < 0.001) {
                    zoomLevel = 19;
                } else if (maxSpan < 0.003) {
                    zoomLevel = 18;
                } else {
                    zoomLevel = 17;
                }
                
                // Small offset south (1/4 of lat span) to show polygon slightly above center
                // This keeps the polygon visible without pushing it to the edge
                centerLat -= latSpan * 0.1;
                
                console.log(`   📍 Map center: ${centerLat.toFixed(6)}, ${centerLng.toFixed(6)} (zoom ${zoomLevel}, span: ${maxSpan.toFixed(6)})`);
            }
        }
        
        // Use calculated center, provided mapCenter, or address
        if (centerLat && centerLng) {
            params.set('center', `${centerLat},${centerLng}`);
        } else if (mapCenter && mapCenter.lat && mapCenter.lng) {
            params.set('center', `${mapCenter.lat},${mapCenter.lng}`);
        } else if (address) {
            const encodedAddr = encodeURIComponent(address);
            params.set('center', encodedAddr);
        } else {
            resolve(null);
            return;
        }
        
        // Use calculated zoom level
        params.set('zoom', zoomLevel.toString());
        
        // Build URL with polygon paths
        let url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
        console.log(`   🔗 Static map base URL params: center=${params.get('center')}, zoom=${params.get('zoom')}`);
        
        // Add polygons if available
        if (polygons && polygons.length > 0) {
            for (const poly of polygons) {
                if (poly.coords && poly.coords.length >= 3) {
                    // Close the polygon by adding first point at end
                    const closedCoords = [...poly.coords, poly.coords[0]];
                    const encoded = encodePolyline(closedCoords);
                    
                    // Color based on type (lawn=green, mulch=brown)
                    const fillColor = poly.type === 'lawn' ? '00FF0040' : '8B451340';
                    const strokeColor = poly.type === 'lawn' ? '00FF00' : '8B4513';
                    
                    url += `&path=fillcolor:0x${fillColor}|color:0x${strokeColor}|weight:2|enc:${encoded}`;
                }
            }
        } else {
            // Just add a marker if no polygons
            if (mapCenter && mapCenter.lat && mapCenter.lng) {
                url += `&markers=color:green|${mapCenter.lat},${mapCenter.lng}`;
            }
        }
        
        console.log(`   🔗 Final URL length: ${url.length} chars`);
        
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                console.log(`   ⚠️  Static map failed: HTTP ${res.statusCode}`);
                resolve(null);
                return;
            }
            
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                console.log(`   🗺️  Static map generated: ${buffer.length} bytes`);
                resolve(buffer);
            });
        }).on('error', (e) => {
            console.log(`   ⚠️  Static map error: ${e.message}`);
            resolve(null);
        });
    });
}

// Service name mapping for display (includes all frequency options)
const SERVICE_LABELS = {
    // Mowing frequencies
    'mowing': 'Weekly Mowing',
    'weekly': 'Weekly Mowing',
    'biweekly': 'Bi-Weekly Mowing',
    'onetime': 'One-Time Mowing',
    
    // Lawn services - Aeration types
    'aeration': 'Aeration',
    'single': 'Lawn Aeration (Single Pass)',
    'double': 'Lawn Aeration (Double Pass)',
    
    // Overseeding types
    'overseeding': 'Overseeding',
    'standard': 'Standard Overseeding',
    'complete': 'Overseeding + Peat Moss + Starter Fertilizer',
    
    'weed_control': 'Weed Control',
    'power_raking': 'Power Raking',
    
    // Fertilization frequencies
    'fertilization': 'Fertilization',
    'standard_fert': 'Standard Fertilization',
    'premium_fert': 'Premium Fertilization',
    'fertilizer': 'Fertilization',
    'recurring': 'Fertilization (Every 4-6 Weeks)',
    
    // Mulch colors
    'mulch': 'Mulch Install',
    'black': 'Black Mulch',
    'brown': 'Brown Mulch',
    'red': 'Red Mulch',
    
    // Cleanup services
    'cleanup': 'Cleanup',
    'yard_cleanup': 'Yard Cleanup',
    'leaf_cleanup': 'Leaf Cleanup',
    
    // Bush trimming frequencies
    'bush_trimming': 'Bush Trimming',
    'once': 'One-Time Bush Trimming',
    'twice': 'Twice Yearly Trimming',
    'monthly': 'Bush Trimming (Monthly)',
    'bimonthly': 'Bush Trimming (Every 2 Months)',
    'quarterly': 'Bush Trimming (Every 3 Months)',
    
    // Other
    'snow': 'Snow Removal',
    'in_person': 'In-Person Estimate'
};

// Normalize services from object or array to readable array of strings
function normalizeServices(services) {
    if (!services) return [];
    
    // If already an array, just map to labels
    if (Array.isArray(services)) {
        return services.map(s => SERVICE_LABELS[s] || s);
    }
    
    // If object, extract keys/values
    if (typeof services === 'object') {
        const result = [];
        for (const [key, value] of Object.entries(services)) {
            if (value === true) {
                result.push(SERVICE_LABELS[key] || key);
            } else if (typeof value === 'string') {
                // e.g., mowing: 'weekly', mulch: 'black'
                result.push(SERVICE_LABELS[value] || SERVICE_LABELS[key] || `${key}: ${value}`);
            }
        }
        return result;
    }
    
    return [];
}

// Weed Man services (handled by our partner, not by NMW directly)
const WEEDMAN_SERVICES = ['weed_control', 'fertilizer', 'fertilization', 'insect_control', 'weed_control_fertilizer', 'insect_control_only'];

// Check if a quote request is Weed Man-only (no NMW services)
function isWeedManOnly(services) {
    if (!services) return false;
    
    let hasWeedMan = false;
    let hasNmw = false;
    
    const checkService = (key, value) => {
        const isWeedManService = WEEDMAN_SERVICES.includes(key) || 
                                  WEEDMAN_SERVICES.includes(value) ||
                                  key === 'weedMan' ||
                                  (key === 'weed_control' || key === 'fertilizer' || key === 'insect_control');
        if (value && isWeedManService) {
            hasWeedMan = true;
        } else if (value && !isWeedManService && key !== 'weedManPayment') {
            hasNmw = true;
        }
    };
    
    if (Array.isArray(services)) {
        services.forEach(s => checkService(s, true));
    } else if (typeof services === 'object') {
        for (const [key, value] of Object.entries(services)) {
            // Skip nested weedMan object, check its contents
            if (key === 'weedMan' && typeof value === 'object') {
                for (const [wk, wv] of Object.entries(value)) {
                    if (wk !== 'payment' && wv) hasWeedMan = true;
                }
            } else {
                checkService(key, value);
            }
        }
    }
    
    return hasWeedMan && !hasNmw;
}

// Discord webhook for notifications (posts to #general)
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || 'https://discord.com/api/webhooks/1466597465355456685/bNW5bKm93ATWSIc5unPS3Z9Eto6biCKXqBPNcD3rixO9iMBLDS3bLwlzQpQK4f7ZngaH';
const DISCORD_USER_ID = '402602300184461322'; // Chris's Discord ID for mentions
const CLAWD_USER_ID = '1465090401172979803'; // Clawd's Discord ID for mentions

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

async function saveSnapshot(quote) {
    const date = new Date().toISOString().split('T')[0];
    const dateDir = path.join(SNAPSHOTS_DIR, date);
    if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
    }
    
    const cleanEmail = (quote.email || 'unknown').toLowerCase().replace(/[^a-z0-9@.-]/g, '_');
    const filename = `${cleanEmail}_${quote.submissionId || Date.now()}.png`;
    const filepath = path.join(dateDir, filename);
    
    // Try to use client-provided snapshot first
    if (quote.snapshot) {
        const base64Data = quote.snapshot.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Validate the snapshot - a valid PNG is at least 100 bytes
        if (buffer.length > 100) {
            fs.writeFileSync(filepath, buffer);
            console.log(`   📸 Client snapshot saved: ${filepath} (${buffer.length} bytes)`);
            return filepath;
        } else {
            console.log(`   ⚠️  Client snapshot invalid (${buffer.length} bytes), using static map fallback`);
        }
    }
    
    // Fallback: Generate static map from Google Maps API with polygons
    const staticMapBuffer = await generateStaticMap(quote.address, quote.mapCenter, quote.polygons);
    if (staticMapBuffer) {
        fs.writeFileSync(filepath, staticMapBuffer);
        console.log(`   📸 Static map saved: ${filepath}`);
        return filepath;
    }
    
    console.log(`   ⚠️  No map snapshot available`);
    return null;
}

function savePhotos(quote) {
    if (!quote.photos || quote.photos.length === 0) return [];
    
    const date = new Date().toISOString().split('T')[0];
    const cleanEmail = (quote.email || 'unknown').toLowerCase().replace(/[^a-z0-9@.-]/g, '_');
    const dateDir = path.join(PHOTOS_DIR, date, cleanEmail + '_' + (quote.submissionId || Date.now()));
    
    if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
    }
    
    // Deduplicate photos by base64 content
    const seenData = new Set();
    const uniquePhotos = [];
    for (const photo of quote.photos) {
        const photoData = typeof photo === 'string' ? photo : photo.data;
        if (!seenData.has(photoData)) {
            seenData.add(photoData);
            uniquePhotos.push(photo);
        } else {
            console.log(`   ⚠️ Skipping duplicate photo`);
        }
    }
    
    if (uniquePhotos.length !== quote.photos.length) {
        console.log(`   📷 Deduplicated: ${quote.photos.length} → ${uniquePhotos.length} photos`);
    }
    
    const savedPaths = [];
    uniquePhotos.forEach((photo, i) => {
        // Handle both formats: string (base64 data URI) or object with {type, data}
        const photoData = typeof photo === 'string' ? photo : photo.data;
        const photoType = typeof photo === 'string' 
            ? (photoData.includes('image/png') ? 'image/png' : 'image/jpeg')
            : photo.type;
        
        const ext = photoType === 'image/png' ? 'png' : 'jpg';
        const filename = `photo_${i + 1}.${ext}`;
        const filepath = path.join(dateDir, filename);
        
        const base64Data = photoData.replace(/^data:image\/[a-z]+;base64,/, '');
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
    // Save notification for backup/reference
    const notificationFile = path.join(__dirname, 'pending-notifications.json');
    
    const notification = {
        timestamp: new Date().toISOString(),
        quote: {
            name: quote.name,
            email: quote.email,
            phone: quote.phone,
            address: quote.address,
            services: quote.services,
            selectedPackage: quote.selectedPackage,
            packageWasEdited: quote.packageWasEdited,
            mowingType: quote.mowingType,
            turfSqft: quote.turfSqft,
            lawnSqft: quote.lawnSqft,
            mulchSqft: quote.mulchSqft,
            mulchCuFt: quote.mulchCuFt,
            mulchColor: quote.mulchColor,
            notes: quote.notes,
            propertyNotes: quote.propertyNotes,
            additionalNotes: quote.additionalNotes,
            referralSource: quote.referralSource,
            weedManServices: quote.weedManServices,
            weedManPayment: quote.weedManPayment,
            // Property details
            hasGate: quote.hasGate,
            gateWidth: quote.gateWidth,
            gateCode: quote.gateCode,
            hasDog: quote.hasDog,
            hasStairs: quote.hasStairs,
            isOvergrown: quote.isOvergrown,
            grassHeight: quote.grassHeight
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
    
    // Post directly to Discord via webhook
    if (DISCORD_WEBHOOK) {
        try {
            const services = normalizeServices(quote.services);
            const weedManOnly = isWeedManOnly(quote.services);
            
            // Get package display name
            const packageNames = { essential: 'Essentials', complete: 'Complete Care', total: 'Premium' };
            let packageDisplay = 'Custom';
            if (quote.selectedPackage) {
                packageDisplay = packageNames[quote.selectedPackage] || quote.selectedPackage;
                if (quote.packageWasEdited) packageDisplay += ' (Edited)';
            }
            
            // Format square footage with commas
            const formatSqft = (val) => {
                const num = typeof val === 'number' ? val : parseInt(val);
                return num.toLocaleString();
            };
            
            // Build the message content
            let content = weedManOnly 
                ? `🌿 **Weed Man Request** *(awaiting Weed Man pricing)*\n\n`
                : `🆕 **New Quote Request**\n\n`;
            content += `**Name:** ${quote.name || 'Not provided'}\n`;
            content += `**Email:** ${quote.email || 'Not provided'}\n`;
            content += `**Phone:** ${quote.phone || 'Not provided'}\n`;
            content += `**Address:** ${quote.address || 'Not provided'}\n\n`;
            
            content += `📦 **Package:** ${packageDisplay}\n`;
            content += `📣 **How found us:** ${quote.referralSource || 'Not specified'}\n\n`;
            
            content += `**Services Requested:**\n`;
            services.forEach(s => content += `• ${s}\n`);
            
            // Add Weed Man services if present
            if (quote.weedManServices && quote.weedManServices.length > 0) {
                const weedManNames = { weed_control: 'Weed Control', fertilizer: 'Fertilization', combo: 'Weed Control + Fertilizer', insect: 'Insect Control', grub: 'Grub Control' };
                content += `\n🌿 **Weed Man Services (Partner):**\n`;
                quote.weedManServices.forEach(s => content += `• ${weedManNames[s] || s}\n`);
                if (quote.weedManPayment) {
                    const paymentDisplay = quote.weedManPayment === 'annual' ? 'Annual (Pre-Pay Discount)' : 'Per Service';
                    content += `💳 Payment: ${paymentDisplay}\n`;
                }
            }
            
            content += `\n`;
            if (quote.turfSqft || quote.lawnSqft) {
                content += `**Lawn Sqft:** ${formatSqft(quote.turfSqft || quote.lawnSqft)} sq ft\n`;
            }
            if (quote.mulchSqft) {
                content += `**Mulch:** ${formatSqft(quote.mulchSqft)} sq ft / ${quote.mulchCuFt || 'N/A'} cu ft\n`;
            }
            content += `\n**Property Details:**\n`;
            // Gate - always show
            if (quote.hasGate) {
                let gateInfo = 'Yes';
                if (quote.gateWidth) gateInfo += ` (${quote.gateWidth}" wide)`;
                if (quote.gateCode) gateInfo += ` — Code: ${quote.gateCode}`;
                content += `• Gate: ${gateInfo}\n`;
            } else {
                content += `• Gate: No\n`;
            }
            // Dogs - always show
            content += `• Dogs: ${quote.hasDog ? 'Yes' : 'No'}\n`;
            // Overgrown - always show
            if (quote.isOvergrown) {
                let overgrownInfo = 'Yes';
                if (quote.grassHeight) overgrownInfo += ` (~${quote.grassHeight}" tall)`;
                content += `• Lawn Overgrown: ${overgrownInfo}\n`;
            } else {
                content += `• Lawn Overgrown: No\n`;
            }
            // Stairs - always show
            content += `• Stairs to Backyard: ${quote.hasStairs ? 'Yes' : 'No'}\n`;
            
            // Notes - separate page 1 and page 3 if available
            content += `\n`;
            if (quote.propertyNotes || quote.additionalNotes) {
                if (quote.propertyNotes) {
                    content += `**📝 Property Notes:** ${quote.propertyNotes}\n`;
                }
                if (quote.additionalNotes) {
                    content += `**💬 Additional Notes:** ${quote.additionalNotes}\n`;
                }
            } else if (quote.notes) {
                content += `**Notes:** ${quote.notes}\n`;
            } else {
                content += `**Notes:** None\n`;
            }
            
            content += `\n`;
            if (copilotResult?.customer?.customerId) {
                content += `**Copilot:** Customer ID ${copilotResult.customer.customerId}`;
                if (copilotResult.property?.propertyId) {
                    content += `, Property ID ${copilotResult.property.propertyId}`;
                }
                content += ` ✅\n`;
            }
            
            // Add special note for Weed Man-only requests
            if (weedManOnly) {
                content += `\n⏳ **Action Required:** Contact Weed Man for pricing before sending estimate.\n`;
            }
            
            content += `\n<@${DISCORD_USER_ID}> <@${CLAWD_USER_ID}>`;
            
            const webhookData = {
                content: content,
                allowed_mentions: {
                    users: [DISCORD_USER_ID, CLAWD_USER_ID]
                }
            };
            
            const webhookUrl = new URL(DISCORD_WEBHOOK);
            
            // Collect all files to attach (snapshot first, then customer photos, max 10)
            const filesToAttach = [];
            
            // Add snapshot as first file if it exists
            if (snapshotPath && fs.existsSync(snapshotPath)) {
                filesToAttach.push({
                    path: snapshotPath,
                    filename: 'property_map.png',
                    contentType: 'image/png'
                });
            }
            
            // Add customer photos (up to 9 more, total 10 max)
            if (photoPaths && photoPaths.length > 0) {
                const maxPhotos = Math.min(photoPaths.length, 10 - filesToAttach.length);
                for (let i = 0; i < maxPhotos; i++) {
                    const photoPath = photoPaths[i];
                    if (fs.existsSync(photoPath)) {
                        const ext = path.extname(photoPath).toLowerCase();
                        const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
                        filesToAttach.push({
                            path: photoPath,
                            filename: `customer_photo_${i + 1}${ext}`,
                            contentType: contentType
                        });
                    }
                }
            }
            
            // If we have files to attach, use multipart/form-data
            if (filesToAttach.length > 0) {
                const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
                
                // Build multipart form data as array of buffers
                const parts = [];
                
                // Add payload_json field
                parts.push(Buffer.from(
                    `--${boundary}\r\n` +
                    `Content-Disposition: form-data; name="payload_json"\r\n` +
                    `Content-Type: application/json\r\n\r\n` +
                    JSON.stringify(webhookData) + '\r\n'
                ));
                
                // Add each file
                for (let i = 0; i < filesToAttach.length; i++) {
                    const file = filesToAttach[i];
                    const fileBuffer = fs.readFileSync(file.path);
                    
                    // File header
                    parts.push(Buffer.from(
                        `--${boundary}\r\n` +
                        `Content-Disposition: form-data; name="files[${i}]"; filename="${file.filename}"\r\n` +
                        `Content-Type: ${file.contentType}\r\n\r\n`
                    ));
                    
                    // File data
                    parts.push(fileBuffer);
                    
                    // File footer
                    parts.push(Buffer.from('\r\n'));
                }
                
                // Final boundary
                parts.push(Buffer.from(`--${boundary}--\r\n`));
                
                // Combine all parts
                const fullBody = Buffer.concat(parts);
                
                const req = https.request(webhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        'Content-Length': fullBody.length
                    }
                }, (res) => {
                    let resBody = '';
                    res.on('data', chunk => resBody += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 200 || res.statusCode === 204) {
                            const photoCount = filesToAttach.length - (snapshotPath ? 1 : 0);
                            console.log(`   🔔 Discord notification posted with ${filesToAttach.length} attachments (map + ${photoCount} photos)!`);
                            notification.notified = true;
                            notifications[notifications.length - 1] = notification;
                            fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2));
                        } else {
                            console.log(`   ⚠️  Discord webhook failed: HTTP ${res.statusCode} - ${resBody}`);
                        }
                    });
                });
                
                req.on('error', (e) => {
                    console.log(`   ⚠️  Discord webhook error: ${e.message}`);
                });
                
                req.write(fullBody);
                req.end();
            } else {
                // No files, send JSON only
                const postData = JSON.stringify(webhookData);
                
                const req = https.request(webhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                }, (res) => {
                    if (res.statusCode === 200 || res.statusCode === 204) {
                        console.log(`   🔔 Discord notification posted!`);
                        notification.notified = true;
                        notifications[notifications.length - 1] = notification;
                        fs.writeFileSync(notificationFile, JSON.stringify(notifications, null, 2));
                    } else {
                        console.log(`   ⚠️  Discord webhook failed: HTTP ${res.statusCode}`);
                    }
                });
                
                req.on('error', (e) => {
                    console.log(`   ⚠️  Discord webhook error: ${e.message}`);
                });
                
                req.write(postData);
                req.end();
            }
        } catch (e) {
            console.log(`   ⚠️  Discord notification error: ${e.message}`);
        }
    }
}

async function saveQuote(quote) {
    const snapshotPath = await saveSnapshot(quote);
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
                quote,
                null,
                snapshotPath  // Pass the map snapshot path
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
    
    // Send email notification to Chris with all details + photos + map
    try {
        console.log('   📧 Sending notification email to Chris...');
        const emailNotifyResult = await sendQuoteNotification(quote, snapshotPath, photoPaths, copilotResult);
        if (emailNotifyResult.success) {
            console.log('   ✅ Notification email sent to Chris!');
        } else {
            console.log(`   ⚠️  Notification email failed: ${emailNotifyResult.error}`);
        }
    } catch (e) {
        console.error('   ⚠️  Notification email error:', e.message);
    }
    
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
    
    // Serve index-updated
    if (url === '/index-updated.html') {
        const content = fs.readFileSync(path.join(__dirname, 'index-updated.html'), 'utf8');
        res.writeHead(200, { 
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache'
        });
        res.end(content);
        return;
    }
    
    // Serve contact page replica with widget
    if (url === '/contact' || url === '/contact-replica.html') {
        const content = fs.readFileSync(path.join(__dirname, 'public', 'contact-replica.html'), 'utf8');
        res.writeHead(200, { 
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache'
        });
        res.end(content);
        return;
    }
    
    // Serve widget only (for iframe embedding)
    if (url === '/widget') {
        const content = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
        res.writeHead(200, { 
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache'
        });
        res.end(content);
        return;
    }
    
    // API: Save quote request (accepts both endpoints)
    if ((url === '/api/quote-request' || url === '/api/quote') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const quote = JSON.parse(body);
                const result = await saveQuote(quote);
                
                console.log('\n🎉 NEW QUOTE REQUEST:');
                console.log(`   Name: ${quote.name}`);
                console.log(`   Email: ${quote.email}`);
                console.log(`   Phone: ${quote.phone}`);
                console.log(`   Address: ${quote.address}`);
                console.log(`   Services: ${normalizeServices(quote.services).join(', ')}`);
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
