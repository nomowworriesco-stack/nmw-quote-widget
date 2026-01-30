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
    'overseeding': 'Overseeding',
    'weed_control': 'Weed Control',
    
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
        return services.map(s => SERVICE_NAMES[s] || s);
    }
    
    // If object, extract keys/values
    if (typeof services === 'object') {
        const result = [];
        for (const [key, value] of Object.entries(services)) {
            if (value === true) {
                result.push(SERVICE_NAMES[key] || key);
            } else if (typeof value === 'string') {
                // e.g., mowing: 'weekly', mulch: 'black'
                result.push(SERVICE_NAMES[value] || SERVICE_NAMES[key] || `${key}: ${value}`);
            }
        }
        return result;
    }
    
    return [];
}

/**
 * Send quote notification email to Chris
 * @param {object} quote - Quote data
 * @param {string} snapshotPath - Path to map snapshot image
 * @param {array} photoPaths - Array of paths to uploaded photos
 * @param {object} copilotResult - Result from Copilot customer creation
 */
async function sendQuoteNotification(quote, snapshotPath, photoPaths = [], copilotResult = null) {
    const services = normalizeServices(quote.services).join(', ');
    const timestamp = new Date().toLocaleString('en-US', { 
        timeZone: 'America/Denver',
        dateStyle: 'medium',
        timeStyle: 'short'
    });
    
    // Build email subject - "New Website Lead - Name"
    const subject = `New Website Lead - ${quote.name}`;
    
    // Build HTML content - cleaner, more readable format
    let html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
        .header { background: #2E7D32; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0 0 5px 0; font-size: 24px; }
        .header .name { font-size: 28px; font-weight: bold; margin: 10px 0; }
        .header .date { font-size: 14px; opacity: 0.9; }
        .content { padding: 20px; background: #f9f9f9; }
        .contact-info { background: white; padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #2E7D32; }
        .contact-info p { margin: 8px 0; }
        .contact-info .label { color: #666; font-size: 12px; text-transform: uppercase; }
        .contact-info .value { font-size: 16px; color: #333; }
        .contact-info a { color: #2E7D32; text-decoration: none; }
        .services { background: #e8f5e9; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .services h3 { margin: 0 0 10px 0; color: #2E7D32; }
        .services ul { margin: 0; padding-left: 20px; }
        .services li { margin: 5px 0; }
        .measurements { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; display: flex; gap: 20px; }
        .measurement { flex: 1; text-align: center; }
        .measurement .number { font-size: 24px; font-weight: bold; color: #2E7D32; }
        .measurement .unit { font-size: 12px; color: #666; }
        .notes { background: #fff3e0; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #ff9800; }
        .notes h3 { margin: 0 0 8px 0; color: #e65100; font-size: 14px; }
        .notes p { margin: 0; }
        .copilot { background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #1976D2; }
        .copilot h3 { margin: 0 0 8px 0; color: #1565C0; font-size: 14px; }
        .copilot a { color: #1976D2; font-weight: bold; }
        .footer { background: #eee; padding: 15px; text-align: center; font-size: 12px; border-radius: 0 0 8px 8px; color: #666; }
        .map-section { margin: 20px 0; text-align: center; }
        .map-section h3 { color: #2E7D32; margin-bottom: 10px; }
        .photos-section { margin: 20px 0; }
        .photos-section h3 { color: #2E7D32; }
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
        
        <div class="services">
            <h3>📋 Services Requested</h3>
            <ul>${services.split(', ').map(s => `<li>${s}</li>`).join('')}</ul>
        </div>
        
        <div class="services" style="background: #fff; border-left: 4px solid #2E7D32;">
            <h3>🏠 Property Details</h3>
            <ul>
                <li><strong>Gate:</strong> ${quote.hasGate ? `Yes${quote.gateWidth ? ` (${quote.gateWidth}" wide)` : ''}${quote.gateCode ? ` — Code: ${quote.gateCode}` : ''}` : 'No'}</li>
                <li><strong>Dogs:</strong> ${quote.hasDog ? 'Yes' : 'No'}</li>
                <li><strong>Lawn Overgrown:</strong> ${quote.isOvergrown ? `Yes${quote.grassHeight ? ` (~${quote.grassHeight}" tall)` : ''}` : 'No'}</li>
                <li><strong>Stairs to Backyard:</strong> ${quote.hasStairs ? 'Yes' : 'No'}</li>
            </ul>
        </div>`;
    
    // Add measurements if available
    if (quote.turfSqft || quote.mulchSqft) {
        html += `<div class="measurements">`;
        if (quote.turfSqft) {
            const sqft = typeof quote.turfSqft === 'number' ? quote.turfSqft : parseInt(quote.turfSqft);
            html += `
            <div class="measurement">
                <div class="number">${sqft.toLocaleString()}</div>
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
    
    // Add customer notes if provided
    if (quote.notes) {
        html += `
        <div class="notes">
            <h3>📝 Customer Notes</h3>
            <p>${quote.notes}</p>
        </div>`;
    }
    
    // Add Copilot info if customer was created
    if (copilotResult?.customer?.success) {
        const customerId = copilotResult.customer.customerId;
        const propertyId = copilotResult.property?.propertyId;
        html += `
        <div class="copilot">
            <h3>✅ Added to Copilot</h3>
            <p>Customer ID: <a href="https://secure.copilotcrm.com/customers/details/${customerId}">${customerId}</a>
            ${propertyId ? `<br>Property ID: ${propertyId}` : ''}</p>
        </div>`;
    }
    
    // Map section - embed inline if available
    if (snapshotPath) {
        html += `
        <div class="map-section">
            <h3>📍 Property Map</h3>
            <img src="cid:map_snapshot" alt="Property Map" style="max-width: 100%; border-radius: 8px; border: 2px solid #2E7D32;" />
        </div>`;
    }
    
    // Photos section note
    if (photoPaths && photoPaths.length > 0) {
        html += `
        <div class="photos-section">
            <h3>📷 Customer Photos (${photoPaths.length})</h3>
            <p><em>See attached photos below</em></p>
        </div>`;
    }
    
    html += `
    </div>
    <div class="footer">
        <p>This notification was sent automatically from your Quote Widget</p>
        <p>No Mow Worries Lawn Care | Aurora, CO</p>
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
