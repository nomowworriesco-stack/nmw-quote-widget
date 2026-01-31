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
    
    // Build HTML content - clean, professional design
    let html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 600px; margin: 0 auto; background: #f5f5f5; }
        .container { background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .header { background: #2E7D32; color: white; padding: 24px; }
        .header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
        .header h1 { margin: 0; font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.9; }
        .header .date { font-size: 12px; opacity: 0.8; }
        .header .name { font-size: 24px; font-weight: 600; margin: 0; }
        .content { padding: 24px; }
        
        /* Contact Info */
        .contact-block { margin-bottom: 24px; }
        .contact-row { display: flex; margin-bottom: 12px; }
        .contact-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-bottom: 2px; }
        .contact-value { font-size: 15px; color: #1a1a1a; }
        .contact-value a { color: #2E7D32; text-decoration: none; }
        
        /* Meta Info */
        .meta-block { display: flex; gap: 24px; padding: 16px 0; border-top: 1px solid #eee; border-bottom: 1px solid #eee; margin-bottom: 24px; }
        .meta-item { font-size: 13px; color: #666; }
        .meta-item strong { color: #1a1a1a; }
        
        /* Section Headers */
        .section { margin-bottom: 24px; }
        .section-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #2E7D32; margin: 0 0 12px 0; padding-bottom: 8px; border-bottom: 2px solid #2E7D32; }
        
        /* Services List */
        .services-list { margin: 0; padding: 0; list-style: none; }
        .services-list li { padding: 8px 0; font-size: 14px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; }
        .services-list li:last-child { border-bottom: none; }
        .service-bullet { width: 6px; height: 6px; border-radius: 50%; background: #2E7D32; margin-right: 12px; flex-shrink: 0; }
        
        /* Property Grid */
        .property-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .property-item { font-size: 14px; }
        .property-item .label { color: #666; }
        .property-item .value { font-weight: 500; }
        
        /* Measurements */
        .measurements { display: flex; gap: 16px; margin-top: 16px; }
        .measurement { background: #f8f9fa; padding: 16px; border-radius: 6px; text-align: center; flex: 1; }
        .measurement .number { font-size: 28px; font-weight: 700; color: #2E7D32; line-height: 1; }
        .measurement .unit { font-size: 12px; color: #666; margin-top: 4px; }
        
        /* Notes */
        .notes-block { background: #f8f9fa; padding: 16px; border-radius: 6px; margin-bottom: 16px; }
        .notes-block .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-bottom: 6px; }
        .notes-block .content { font-size: 14px; color: #1a1a1a; margin: 0; }
        
        /* Weed Man */
        .partner-block { background: #f8f9fa; padding: 16px; border-radius: 6px; margin-bottom: 16px; border-left: 3px solid #7B1FA2; }
        .partner-block .title { font-size: 12px; font-weight: 600; color: #7B1FA2; margin-bottom: 8px; }
        .partner-block .payment { font-size: 12px; color: #666; margin-top: 8px; }
        
        /* Copilot Status */
        .copilot-block { background: #e8f5e9; padding: 16px; border-radius: 6px; margin-bottom: 16px; }
        .copilot-block .status { font-size: 13px; font-weight: 500; color: #2E7D32; }
        .copilot-block a { color: #2E7D32; font-weight: 600; }
        .copilot-block .ids { font-size: 12px; color: #666; margin-top: 4px; }
        
        /* Map */
        .map-block { text-align: center; margin-bottom: 16px; }
        .map-block img { max-width: 100%; border-radius: 6px; border: 1px solid #e0e0e0; }
        
        /* Photos */
        .photos-block { background: #f8f9fa; padding: 12px 16px; border-radius: 6px; font-size: 13px; color: #666; }
        
        /* Footer */
        .footer { background: #f8f9fa; padding: 16px; text-align: center; font-size: 11px; color: #999; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-top">
                <h1>New Website Lead</h1>
                <span class="date">${timestamp}</span>
            </div>
            <p class="name">${quote.name || 'N/A'}</p>
        </div>
        <div class="content">
            <div class="contact-block">
                <div class="contact-row">
                    <div style="flex: 1;">
                        <div class="contact-label">Email</div>
                        <div class="contact-value"><a href="mailto:${quote.email}">${quote.email || 'N/A'}</a></div>
                    </div>
                    <div style="flex: 1;">
                        <div class="contact-label">Phone</div>
                        <div class="contact-value"><a href="tel:${quote.phone}">${quote.phone || 'N/A'}</a></div>
                    </div>
                </div>
                <div>
                    <div class="contact-label">Address</div>
                    <div class="contact-value">${quote.address || 'N/A'}</div>
                </div>
            </div>
            
            <div class="meta-block">
                <div class="meta-item"><strong>Package:</strong> ${packageName}</div>
                <div class="meta-item"><strong>Found us:</strong> ${quote.referralSource || 'Not specified'}</div>
            </div>
            
            <div class="section">
                <h3 class="section-title">Services Requested</h3>
                <ul class="services-list">
                    ${servicesWithColors.map(s => `<li><span class="service-bullet"></span>${s.name}</li>`).join('')}
                </ul>
            </div>`;
    
    // Add Weed Man section if applicable
    if (weedMan) {
        html += `
            <div class="partner-block">
                <div class="title">Weed Man Services (Partner)</div>
                <ul class="services-list" style="margin: 0; padding: 0;">
                    ${weedMan.services.map(s => `<li style="border: none; padding: 4px 0;"><span class="service-bullet" style="background: #7B1FA2;"></span>${s}</li>`).join('')}
                </ul>
                <div class="payment">Preferred Payment: <strong>${weedMan.payment}</strong></div>
            </div>`;
    }
    
    html += `
            <div class="section">
                <h3 class="section-title">Property Details</h3>
                <div class="property-grid">
                    <div class="property-item"><span class="label">Gate:</span> <span class="value">${quote.hasGate ? `Yes${quote.gateWidth ? ` (${quote.gateWidth}")` : ''}${quote.gateCode ? ` Code: ${quote.gateCode}` : ''}` : 'No'}</span></div>
                    <div class="property-item"><span class="label">Dogs:</span> <span class="value">${quote.hasDog ? 'Yes' : 'No'}</span></div>
                    <div class="property-item"><span class="label">Overgrown:</span> <span class="value">${quote.isOvergrown ? `Yes${quote.grassHeight ? ` (~${quote.grassHeight}")` : ''}` : 'No'}</span></div>
                    <div class="property-item"><span class="label">Stairs:</span> <span class="value">${quote.hasStairs ? 'Yes' : 'No'}</span></div>
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
                    <div class="unit">Lawn sq ft</div>
                </div>`;
        }
        if (quote.mulchSqft) {
            const mulchSqft = typeof quote.mulchSqft === 'number' ? quote.mulchSqft : parseInt(quote.mulchSqft);
            html += `
                <div class="measurement">
                    <div class="number">${mulchSqft.toLocaleString()}</div>
                    <div class="unit">Mulch sq ft (${quote.mulchCuFt} cu ft)</div>
                </div>`;
        }
        html += `</div>`;
    }
    
    html += `</div>`; // Close property section
    
    // Add notes sections
    if (quote.propertyNotes || quote.additionalNotes) {
        if (quote.propertyNotes) {
            html += `
            <div class="notes-block">
                <div class="label">Property Notes</div>
                <p class="content">${quote.propertyNotes}</p>
            </div>`;
        }
        if (quote.additionalNotes) {
            html += `
            <div class="notes-block">
                <div class="label">Additional Notes</div>
                <p class="content">${quote.additionalNotes}</p>
            </div>`;
        }
    } else if (quote.notes) {
        html += `
            <div class="notes-block">
                <div class="label">Customer Notes</div>
                <p class="content">${quote.notes}</p>
            </div>`;
    }
    
    // Add Copilot info if customer was created
    if (copilotResult?.customer?.success) {
        const customerId = copilotResult.customer.customerId;
        const propertyId = copilotResult.property?.propertyId;
        html += `
            <div class="copilot-block">
                <div class="status">Added to Copilot</div>
                <div class="ids">Customer: <a href="https://secure.copilotcrm.com/customers/details/${customerId}">${customerId}</a>${propertyId ? ` | Property: ${propertyId}` : ''}</div>
            </div>`;
    }
    
    // Map section
    if (snapshotPath) {
        html += `
            <div class="map-block">
                <img src="cid:map_snapshot" alt="Property Map" />
            </div>`;
    }
    
    // Photos section note
    if (photoPaths && photoPaths.length > 0) {
        html += `
            <div class="photos-block">
                ${photoPaths.length} photo${photoPaths.length > 1 ? 's' : ''} attached
            </div>`;
    }
    
    html += `
        </div>
        <div class="footer">
            No Mow Worries Lawn Care
        </div>
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
