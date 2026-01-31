/**
 * Email Notification Module
 * Sends quote request notifications to Chris via Gmail SMTP
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Gmail SMTP config
const GMAIL_USER = 'nomowworriesco@gmail.com';
const GMAIL_APP_PASSWORD = 'kgzvvajymrbjbeed';
const NOTIFY_EMAIL = 'nomowworriesco@gmail.com'; // Where to send notifications

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // TLS
    auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD
    }
});

// Service name mapping (includes all frequency options)
const SERVICE_NAMES = {
    // Mowing frequencies
    'mowing': 'Weekly Mowing',
    'weekly': 'Weekly Mowing',
    'biweekly': 'Bi-Weekly Mowing',
    'onetime': 'One-Time Mowing',
    
    // Lawn services
    'aeration': 'Aeration',
    'single': 'Lawn Aeration (Single Pass)',
    'double': 'Lawn Aeration (Double Pass)',
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

// Service colors for visual indicators
const SERVICE_COLORS = {
    mowing: '#2E7D32',      // Green
    aeration: '#1976D2',     // Blue
    overseeding: '#388E3C',  // Light green
    fertilization: '#7B1FA2', // Purple
    weed_control: '#F57C00', // Orange
    mulch: '#5D4037',        // Brown
    cleanup: '#455A64',      // Gray-blue
    bush_trimming: '#00796B', // Teal
    snow: '#0288D1',         // Light blue
    power_raking: '#689F38', // Lime green
    default: '#666666'       // Default gray
};

// Weed Man service names
const WEEDMAN_NAMES = {
    'weed_control': 'Weed Control',
    'fertilizer': 'Fertilization',
    'combo': 'Weed Control + Fertilizer',
    'insect': 'Insect Control',
    'grub': 'Grub Control'
};

// Package names
const PACKAGE_NAMES = {
    'essential': 'Essentials',
    'complete': 'Complete Care',
    'total': 'Premium'
};

// Get service color
function getServiceColor(serviceKey) {
    // Normalize key
    const key = serviceKey.toLowerCase().replace(/[^a-z_]/g, '');
    
    // Check for known colors
    if (key.includes('mow')) return SERVICE_COLORS.mowing;
    if (key.includes('aerat')) return SERVICE_COLORS.aeration;
    if (key.includes('overseed')) return SERVICE_COLORS.overseeding;
    if (key.includes('fertil')) return SERVICE_COLORS.fertilization;
    if (key.includes('weed')) return SERVICE_COLORS.weed_control;
    if (key.includes('mulch')) return SERVICE_COLORS.mulch;
    if (key.includes('cleanup') || key.includes('leaf')) return SERVICE_COLORS.cleanup;
    if (key.includes('bush') || key.includes('trim')) return SERVICE_COLORS.bush_trimming;
    if (key.includes('snow')) return SERVICE_COLORS.snow;
    if (key.includes('power') || key.includes('rake')) return SERVICE_COLORS.power_raking;
    
    return SERVICE_COLORS[key] || SERVICE_COLORS.default;
}

// Normalize a service key to readable name
function formatServiceName(key) {
    // Check mapping first
    if (SERVICE_NAMES[key]) return SERVICE_NAMES[key];
    
    // Convert snake_case to Title Case
    return key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

// Normalize services from object or array to readable array of strings with colors
function normalizeServicesWithColors(services) {
    if (!services) return [];
    
    const result = [];
    
    // If already an array, just map to labels
    if (Array.isArray(services)) {
        for (const s of services) {
            result.push({
                name: formatServiceName(s),
                color: getServiceColor(s)
            });
        }
        return result;
    }
    
    // If object, extract keys/values
    if (typeof services === 'object') {
        for (const [key, value] of Object.entries(services)) {
            if (value === true) {
                result.push({
                    name: formatServiceName(key),
                    color: getServiceColor(key)
                });
            } else if (typeof value === 'string') {
                // e.g., mowing: 'weekly', mulch: 'black'
                const name = SERVICE_NAMES[value] || SERVICE_NAMES[key] || `${formatServiceName(key)}: ${value}`;
                result.push({
                    name: name,
                    color: getServiceColor(key)
                });
            }
        }
    }
    
    return result;
}

// Format Weed Man services for display
function formatWeedManServices(quote) {
    if (!quote.weedManServices || quote.weedManServices.length === 0) return null;
    
    const services = quote.weedManServices.map(s => WEEDMAN_NAMES[s] || formatServiceName(s));
    const payment = quote.weedManPayment === 'annual' ? 'Annual (Pre-Pay Discount)' : 'Per Service';
    
    return {
        services,
        payment
    };
}

// Get package display name
function getPackageDisplayName(quote) {
    if (!quote.selectedPackage) return 'Custom';
    
    const baseName = PACKAGE_NAMES[quote.selectedPackage] || quote.selectedPackage;
    
    if (quote.packageWasEdited) {
        return `${baseName} (Edited)`;
    }
    
    return baseName;
}

/**
 * Send quote notification email to Chris
 * @param {object} quote - Quote data
 * @param {string} snapshotPath - Path to map snapshot image
 * @param {array} photoPaths - Array of paths to uploaded photos
 * @param {object} copilotResult - Result from Copilot customer creation
 */
async function sendQuoteNotification(quote, snapshotPath, photoPaths = [], copilotResult = null) {
    const servicesWithColors = normalizeServicesWithColors(quote.services);
    const weedMan = formatWeedManServices(quote);
    const packageName = getPackageDisplayName(quote);
    
    const timestamp = new Date().toLocaleString('en-US', { 
        timeZone: 'America/Denver',
        dateStyle: 'medium',
        timeStyle: 'short'
    });
    
    // Build email subject - "New Website Lead - Name"
    const subject = `New Website Lead - ${quote.name}`;
    
    // Build HTML content - cleaner, more compact format
    let html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.5; color: #333; max-width: 600px; margin: 0 auto; }
        .header { background: #2E7D32; color: white; padding: 15px 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0 0 3px 0; font-size: 18px; font-weight: normal; }
        .header .name { font-size: 22px; font-weight: bold; margin: 5px 0; }
        .header .date { font-size: 12px; opacity: 0.9; }
        .content { padding: 15px; background: #f9f9f9; }
        .contact-info { background: white; padding: 12px; border-radius: 6px; margin-bottom: 12px; border-left: 4px solid #2E7D32; }
        .contact-info p { margin: 5px 0; }
        .contact-info .label { color: #666; font-size: 11px; text-transform: uppercase; }
        .contact-info .value { font-size: 14px; color: #333; }
        .contact-info a { color: #2E7D32; text-decoration: none; }
        .section { background: white; padding: 12px; border-radius: 6px; margin: 10px 0; }
        .section h3 { margin: 0 0 8px 0; font-size: 14px; color: #2E7D32; display: flex; align-items: center; gap: 6px; }
        .section h3 svg { width: 16px; height: 16px; }
        .services-list { margin: 0; padding: 0; list-style: none; }
        .services-list li { display: flex; align-items: center; padding: 4px 0; font-size: 13px; }
        .service-dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; flex-shrink: 0; }
        .property-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 13px; }
        .property-item { display: flex; }
        .property-item strong { min-width: 100px; }
        .measurements { display: flex; gap: 15px; margin-top: 10px; }
        .measurement { background: #e8f5e9; padding: 8px 12px; border-radius: 6px; text-align: center; flex: 1; }
        .measurement .number { font-size: 18px; font-weight: bold; color: #2E7D32; }
        .measurement .unit { font-size: 11px; color: #666; }
        .notes-section { background: #fff3e0; padding: 10px 12px; border-radius: 6px; margin: 10px 0; border-left: 4px solid #ff9800; }
        .notes-section h4 { margin: 0 0 5px 0; color: #e65100; font-size: 12px; }
        .notes-section p { margin: 0; font-size: 13px; }
        .copilot { background: #e3f2fd; padding: 10px 12px; border-radius: 6px; margin: 10px 0; border-left: 4px solid #1976D2; font-size: 13px; }
        .copilot a { color: #1976D2; font-weight: bold; }
        .meta-row { display: flex; gap: 15px; font-size: 12px; color: #666; margin: 10px 0; }
        .meta-item { display: flex; align-items: center; gap: 4px; }
        .map-section { margin: 15px 0; text-align: center; }
        .map-section h3 { color: #2E7D32; margin-bottom: 8px; font-size: 13px; }
        .map-section img { max-width: 100%; max-height: 250px; border-radius: 6px; border: 1px solid #ddd; }
        .weedman { background: #f3e5f5; padding: 10px 12px; border-radius: 6px; margin: 10px 0; border-left: 4px solid #7B1FA2; }
        .weedman h4 { margin: 0 0 5px 0; color: #7B1FA2; font-size: 12px; }
        .weedman .payment { font-size: 11px; color: #666; margin-top: 5px; }
        .footer { background: #eee; padding: 10px; text-align: center; font-size: 11px; border-radius: 0 0 8px 8px; color: #666; }
    </style>
</head>
<body>
    <div class="header">
        <h1>New Website Lead</h1>
        <div class="name">${quote.name || 'N/A'}</div>
        <div class="date">${timestamp}</div>
    </div>
    <div class="content">
        <div class="contact-info">
            <p><span class="label">Email</span><br><span class="value"><a href="mailto:${quote.email}">${quote.email || 'N/A'}</a></span></p>
            <p><span class="label">Phone</span><br><span class="value"><a href="tel:${quote.phone}">${quote.phone || 'N/A'}</a></span></p>
            <p><span class="label">Address</span><br><span class="value">${quote.address || 'N/A'}</span></p>
        </div>
        
        <div class="meta-row">
            <div class="meta-item">📦 <strong>Package:</strong> ${packageName}</div>
            <div class="meta-item">📣 <strong>Found us:</strong> ${quote.referralSource || 'Not specified'}</div>
        </div>
        
        <div class="section">
            <h3>📋 Services Requested</h3>
            <ul class="services-list">
                ${servicesWithColors.map(s => `<li><span class="service-dot" style="background: ${s.color};"></span>${s.name}</li>`).join('')}
            </ul>
        </div>`;
    
    // Add Weed Man section if applicable
    if (weedMan) {
        html += `
        <div class="weedman">
            <h4>🌿 Weed Man Services (Partner)</h4>
            <ul class="services-list" style="margin: 5px 0;">
                ${weedMan.services.map(s => `<li style="padding: 2px 0;">• ${s}</li>`).join('')}
            </ul>
            <div class="payment">💳 Preferred Payment: <strong>${weedMan.payment}</strong></div>
        </div>`;
    }
    
    html += `
        <div class="section">
            <h3>🏠 Property Details</h3>
            <div class="property-grid">
                <div class="property-item"><strong>Gate:</strong> ${quote.hasGate ? `Yes${quote.gateWidth ? ` (${quote.gateWidth}")` : ''}${quote.gateCode ? ` Code: ${quote.gateCode}` : ''}` : 'No'}</div>
                <div class="property-item"><strong>Dogs:</strong> ${quote.hasDog ? 'Yes' : 'No'}</div>
                <div class="property-item"><strong>Overgrown:</strong> ${quote.isOvergrown ? `Yes${quote.grassHeight ? ` (~${quote.grassHeight}")` : ''}` : 'No'}</div>
                <div class="property-item"><strong>Stairs:</strong> ${quote.hasStairs ? 'Yes' : 'No'}</div>
            </div>`;
    
    // Add measurements
    if (quote.turfSqft || quote.lawnSqft || quote.mulchSqft) {
        html += `<div class="measurements">`;
        if (quote.turfSqft || quote.lawnSqft) {
            const sqft = quote.turfSqft || quote.lawnSqft;
            const formatted = typeof sqft === 'number' ? sqft.toLocaleString() : parseInt(sqft).toLocaleString();
            html += `
            <div class="measurement">
                <div class="number">${formatted}</div>
                <div class="unit">🌱 Lawn sq ft</div>
            </div>`;
        }
        if (quote.mulchSqft) {
            const mulchSqft = typeof quote.mulchSqft === 'number' ? quote.mulchSqft : parseInt(quote.mulchSqft);
            html += `
            <div class="measurement">
                <div class="number">${mulchSqft.toLocaleString()}</div>
                <div class="unit">🪴 Mulch sq ft (${quote.mulchCuFt} cu ft)</div>
            </div>`;
        }
        html += `</div>`;
    }
    
    html += `</div>`; // Close property section
    
    // Add notes sections (separate page 1 and page 3)
    if (quote.propertyNotes || quote.additionalNotes) {
        if (quote.propertyNotes) {
            html += `
            <div class="notes-section">
                <h4>📝 Property Notes (Page 1)</h4>
                <p>${quote.propertyNotes}</p>
            </div>`;
        }
        if (quote.additionalNotes) {
            html += `
            <div class="notes-section" style="background: #e8f5e9; border-left-color: #4CAF50;">
                <h4 style="color: #2E7D32;">💬 Additional Notes (Review Page)</h4>
                <p>${quote.additionalNotes}</p>
            </div>`;
        }
    } else if (quote.notes) {
        // Fallback for old format
        html += `
        <div class="notes-section">
            <h4>📝 Customer Notes</h4>
            <p>${quote.notes}</p>
        </div>`;
    }
    
    // Add Copilot info if customer was created
    if (copilotResult?.customer?.success) {
        const customerId = copilotResult.customer.customerId;
        const propertyId = copilotResult.property?.propertyId;
        html += `
        <div class="copilot">
            ✅ <strong>Added to Copilot</strong> — 
            Customer: <a href="https://secure.copilotcrm.com/customers/details/${customerId}">${customerId}</a>
            ${propertyId ? ` | Property: ${propertyId}` : ''}
        </div>`;
    }
    
    // Map section - compact inline if available
    if (snapshotPath) {
        html += `
        <div class="map-section">
            <h3>📍 Property Map</h3>
            <img src="cid:map_snapshot" alt="Property Map" />
        </div>`;
    }
    
    // Photos section note
    if (photoPaths && photoPaths.length > 0) {
        html += `
        <div class="section" style="background: #fafafa;">
            <h3>📷 Customer Photos (${photoPaths.length})</h3>
            <p style="font-size: 12px; color: #666; margin: 0;"><em>See attached photos</em></p>
        </div>`;
    }
    
    html += `
    </div>
    <div class="footer">
        Quote Widget | No Mow Worries Lawn Care
    </div>
</body>
</html>`;

    // Build attachments array
    const attachments = [];
    
    // Add map snapshot if exists
    if (snapshotPath && fs.existsSync(snapshotPath)) {
        attachments.push({
            filename: 'map_snapshot.png',
            path: snapshotPath,
            cid: 'map_snapshot' // Content-ID for inline reference
        });
    }
    
    // Add customer photos
    if (photoPaths && photoPaths.length > 0) {
        photoPaths.forEach((photoPath, i) => {
            if (fs.existsSync(photoPath)) {
                const ext = path.extname(photoPath).toLowerCase();
                attachments.push({
                    filename: `customer_photo_${i + 1}${ext}`,
                    path: photoPath
                });
            }
        });
    }
    
    // Send email
    try {
        const info = await transporter.sendMail({
            from: `"No Mow Worries" <${GMAIL_USER}>`,
            to: NOTIFY_EMAIL,
            subject: subject,
            html: html,
            attachments: attachments
        });
        
        console.log(`   📧 Notification email sent: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`   ❌ Email notification failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Verify SMTP connection
 */
async function verifyConnection() {
    try {
        await transporter.verify();
        console.log('✅ Gmail SMTP connection verified');
        return true;
    } catch (error) {
        console.error('❌ Gmail SMTP connection failed:', error.message);
        return false;
    }
}

module.exports = {
    sendQuoteNotification,
    verifyConnection
};
