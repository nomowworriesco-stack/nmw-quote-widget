/**
 * Copilot CRM Integration Module
 * Creates customers and properties from quote requests
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'copilot-config.json');

// Service name mapping for display
const SERVICE_LABELS = {
    'mowing': 'Weekly Mowing',
    'weekly': 'Weekly Mowing',
    'biweekly': 'Bi-Weekly Mowing',
    'onetime': 'One-Time Mowing',
    'aeration': 'Aeration',
    'overseeding': 'Overseeding',
    'fertilization': 'Fertilization',
    'standard_fert': 'Standard Fertilization',
    'premium_fert': 'Premium Fertilization',
    'fertilizer': 'Fertilization',
    'weed_control': 'Weed Control',
    'mulch': 'Mulch Install',
    'black': 'Black Mulch',
    'brown': 'Brown Mulch',
    'red': 'Red Mulch',
    'cleanup': 'Cleanup',
    'yard_cleanup': 'Yard Cleanup',
    'leaf_cleanup': 'Leaf Cleanup',
    'bush_trimming': 'Bush Trimming',
    'once': 'One-Time Bush Trimming',
    'twice': 'Twice Yearly Trimming',
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

// Check if a specific service is selected (handles both object and array formats)
function hasService(services, serviceName) {
    if (!services) return false;
    if (Array.isArray(services)) return services.includes(serviceName);
    if (typeof services === 'object') return !!services[serviceName];
    return false;
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading Copilot config:', e.message);
    }
    return { enabled: false };
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (e) {
        console.error('Error saving Copilot config:', e.message);
    }
}

/**
 * Check if token is expiring soon (within 7 days)
 */
function isTokenExpiringSoon(config) {
    if (!config.tokenExpiresAt) return true;
    const sevenDaysFromNow = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
    return config.tokenExpiresAt < sevenDaysFromNow;
}

/**
 * Refresh Copilot authentication tokens
 * Uses stored credentials to get fresh cookies
 */
async function refreshToken(config) {
    if (!config.auth || !config.auth.username || !config.auth.password) {
        console.error('No auth credentials stored for token refresh');
        return false;
    }

    return new Promise((resolve) => {
        const postData = new URLSearchParams({
            username: config.auth.username,
            password: config.auth.password
        }).toString();

        const options = {
            hostname: 'secure.copilotcrm.com',
            port: 443,
            path: '/login/doLogin',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            
            // Extract cookies from response headers
            const cookies = res.headers['set-cookie'] || [];
            let newInstantInvoices = null;
            let newAccessToken = null;

            for (const cookie of cookies) {
                if (cookie.startsWith('instantinvoices=')) {
                    newInstantInvoices = cookie.split(';')[0].split('=')[1];
                }
                if (cookie.startsWith('copilotApiAccessToken=')) {
                    newAccessToken = cookie.split(';')[0].split('=')[1];
                }
            }

            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    if (result.status && newAccessToken) {
                        // Update config with new tokens
                        config.cookies.copilotApiAccessToken = newAccessToken;
                        if (newInstantInvoices) {
                            config.cookies.instantinvoices = newInstantInvoices;
                        }
                        
                        // Parse JWT to get expiration
                        try {
                            const payload = JSON.parse(Buffer.from(newAccessToken.split('.')[1], 'base64').toString());
                            config.tokenExpiresAt = payload.exp;
                        } catch (e) {
                            // Set default 60 day expiration
                            config.tokenExpiresAt = Math.floor(Date.now() / 1000) + (60 * 24 * 60 * 60);
                        }
                        
                        config.lastRefreshed = new Date().toISOString();
                        saveConfig(config);
                        console.log('Copilot tokens refreshed successfully, expires:', new Date(config.tokenExpiresAt * 1000).toISOString());
                        resolve(true);
                    } else {
                        console.error('Token refresh failed:', result.errmsg || 'Unknown error');
                        resolve(false);
                    }
                } catch (e) {
                    console.error('Token refresh parse error:', e.message);
                    resolve(false);
                }
            });
        });

        req.on('error', (e) => {
            console.error('Token refresh request error:', e.message);
            resolve(false);
        });
        
        req.write(postData);
        req.end();
    });
}

/**
 * Ensure tokens are fresh before making API calls
 */
async function ensureFreshToken() {
    const config = loadConfig();
    if (!config.enabled) return config;
    
    if (isTokenExpiringSoon(config)) {
        console.log('Copilot token expiring soon, refreshing...');
        await refreshToken(config);
        return loadConfig(); // Reload with fresh tokens
    }
    return config;
}

function getCookieHeader(config) {
    const { cookies } = config;
    return `instantinvoices=${cookies.instantinvoices}; copilotApiAccessToken=${cookies.copilotApiAccessToken}`;
}

/**
 * Make a POST request to Copilot REST API
 */
function copilotPost(endpoint, data, config, referer = 'https://secure.copilotcrm.com/') {
    return new Promise((resolve, reject) => {
        const postData = new URLSearchParams(data).toString();
        
        const options = {
            hostname: 'secure.copilotcrm.com',
            port: 443,
            path: endpoint,
            method: 'POST',
            headers: {
                'Cookie': getCookieHeader(config),
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Referer': referer,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    resolve(result);
                } catch (e) {
                    resolve({ status: false, raw: body });
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

/**
 * Parse name into first and last name
 */
function parseName(fullName) {
    const parts = (fullName || '').trim().split(/\s+/);
    if (parts.length === 1) {
        return { firstName: parts[0] || 'Customer', lastName: '' };
    }
    return {
        firstName: parts[0],
        lastName: parts.slice(1).join(' ')
    };
}

/**
 * Parse address into components
 */
function parseAddress(address) {
    // Try to parse: "123 Main St, Aurora, CO 80015" or similar
    const result = {
        street: '',
        city: '',
        state: 'CO',
        zip: ''
    };
    
    if (!address) return result;
    
    // Try to extract state code (2 uppercase letters) and zip code together
    // This ensures we get the REAL zip code after the state, not a house number
    const stateZipMatch = address.match(/\b([A-Z]{2})\s*(\d{5})(?:-\d{4})?\b/);
    if (stateZipMatch) {
        result.state = stateZipMatch[1];
        result.zip = stateZipMatch[2];
    } else {
        // Fallback: try to extract zip code from end of address (last 5 digits)
        const endZipMatch = address.match(/(\d{5})(?:-\d{4})?(?:\s*,?\s*USA?)?\s*$/i);
        if (endZipMatch) {
            result.zip = endZipMatch[1];
        }
        
        // Try to extract state code separately
        const stateMatch = address.match(/\b([A-Z]{2})\s*(?:\d{5}|$)/);
        if (stateMatch) {
            result.state = stateMatch[1];
        }
    }
    
    // Split by comma
    const parts = address.split(',').map(p => p.trim());
    
    if (parts.length >= 1) {
        // Street is first part, but remove any state/zip that might be there
        result.street = parts[0].replace(/\s+[A-Z]{2}\s*\d{5}.*$/, '').trim();
    }
    
    if (parts.length >= 2) {
        // City is second part, clean it up
        result.city = parts[1].replace(/\s+[A-Z]{2}\s*\d{5}.*$/, '').trim();
    }
    
    if (parts.length >= 3) {
        // Last part might be "CO 80015" or just "80015" - already extracted above
        // But might also have city name embedded
        const lastPart = parts[parts.length - 1];
        const stateZipMatch = lastPart.match(/([A-Z]{2})?\s*(\d{5})?/);
        if (stateZipMatch) {
            if (stateZipMatch[1]) result.state = stateZipMatch[1];
            if (stateZipMatch[2]) result.zip = stateZipMatch[2];
        }
    }
    
    // If no city found but we have a zip, try to infer Aurora area
    if (!result.city && result.zip) {
        // Aurora/Centennial area zips
        const auroraZips = ['80010', '80011', '80012', '80013', '80014', '80015', '80016', '80017', '80018', '80019', '80040', '80041', '80042', '80044', '80045', '80046', '80047'];
        if (auroraZips.includes(result.zip)) {
            result.city = 'Aurora';
        }
    }
    
    return result;
}

/**
 * Map referral source to Copilot's "How This Customer Found Out About Us" field
 * These values match Copilot's dropdown options
 */
const COPILOT_SOURCE_MAP = {
    'google': 'Google',
    'nextdoor': 'Nextdoor',
    'referral': 'Referral',
    'facebook': 'Facebook',
    'yard_sign': 'Yard Sign',
    'flyer': 'Flyer/Door Hanger',
    'other': 'Other'
};

/**
 * Build CUSTOMER notes (general info + customer's written notes)
 * IMPORTANT: Include ALL data from the quote widget here!
 */
function buildCustomerNotes(quote) {
    const lines = [];
    
    // Package selected (if any)
    if (quote.selectedPackage) {
        const packageNames = { 
            'essential': 'Essentials Package', 
            'complete': 'Complete Package', 
            'premium': 'Premium Package' 
        };
        lines.push(`📦 Package: ${packageNames[quote.selectedPackage] || quote.selectedPackage}`);
    }
    
    // How they found us
    if (quote.referralSource) {
        const sourceNames = {
            'google': 'Google',
            'nextdoor': 'Nextdoor',
            'referral': 'Referral',
            'facebook': 'Facebook',
            'yard_sign': 'Yard Sign',
            'flyer': 'Flyer/Door Hanger',
            'other': 'Other'
        };
        lines.push(`📣 How found us: ${sourceNames[quote.referralSource] || quote.referralSource}`);
    }
    
    lines.push('');
    
    // Services requested
    const servicesText = normalizeServices(quote.services).join(', ');
    if (servicesText) {
        lines.push(`🎯 Services Requested: ${servicesText}`);
    }
    
    // Weed Man services (if any)
    if (quote.weedManServices && quote.weedManServices.length > 0) {
        const weedManLabels = {
            'weed_control_fertilizer': 'Weed Control + Fertilizer',
            'mosquito_control': 'Mosquito Control',
            'grub_control': 'Grub Control'
        };
        const weedManText = quote.weedManServices.map(s => weedManLabels[s] || s).join(', ');
        lines.push(`🌿 Weed Man Services: ${weedManText}`);
        if (quote.weedManPayment) {
            lines.push(`💳 Payment: ${quote.weedManPayment === 'prepay' ? 'Prepay' : 'Per Service'}`);
        }
    }
    
    lines.push('');
    
    // Measurements summary
    if (quote.lawnSqft || quote.turfSqft) {
        lines.push(`📐 Lawn: ${(quote.lawnSqft || quote.turfSqft).toLocaleString()} sq ft`);
    }
    if (quote.mulchSqft) {
        const mulchInfo = `Mulch: ${quote.mulchSqft.toLocaleString()} sq ft`;
        const colorInfo = quote.mulchColor ? ` (${quote.mulchColor})` : '';
        lines.push(`🌿 ${mulchInfo}${colorInfo}`);
    }
    
    lines.push('');
    
    // Property details
    lines.push('🏠 Property Details:');
    if (quote.hasGate === true) {
        let gateInfo = '• Gate: Yes';
        if (quote.gateWidth) gateInfo += ` (${quote.gateWidth}" wide)`;
        if (quote.gateCode) gateInfo += ` — Code: ${quote.gateCode}`;
        lines.push(gateInfo);
    } else if (quote.hasGate === false) {
        lines.push('• Gate: No');
    }
    
    if (quote.hasDog === true) {
        lines.push('• Dogs: Yes ⚠️');
    } else if (quote.hasDog === false) {
        lines.push('• Dogs: No');
    }
    
    if (quote.isOvergrown === true) {
        let overgrownInfo = '• Lawn Overgrown: Yes ⚠️';
        if (quote.grassHeight) overgrownInfo += ` (${quote.grassHeight})`;
        lines.push(overgrownInfo);
    } else if (quote.isOvergrown === false) {
        lines.push('• Lawn Overgrown: No');
    }
    
    if (quote.hasStairs === true) {
        lines.push('• Stairs to Backyard: Yes');
    } else if (quote.hasStairs === false) {
        lines.push('• Stairs to Backyard: No');
    }
    
    lines.push('');
    
    // Customer's additional notes - very visible!
    if (quote.notes && quote.notes.trim()) {
        lines.push(`📝 Notes: ${quote.notes.trim()}`);
        lines.push('');
    }
    
    // Consent
    if (quote.smsConsent) {
        lines.push('SMS/Email consent: ✓');
    }
    
    // Timestamp
    lines.push(`Quote submitted: ${new Date(quote.timestamp || Date.now()).toLocaleDateString()}`);
    
    return lines.join('\n');
}

/**
 * Build PROPERTY notes (service-specific details)
 */
function buildPropertyNotes(quote) {
    const lines = [];
    
    // Services requested (normalizeServices handles both object and array formats)
    const servicesText = normalizeServices(quote.services).join(', ');
    lines.push(`Services: ${servicesText}`);
    
    // Mowing type if applicable
    if (quote.mowingType && hasService(quote.services, 'mowing')) {
        const mowingTypeMap = { 'weekly': 'Weekly', 'biweekly': 'Bi-Weekly', 'onetime': 'One-Time' };
        lines.push(`Mowing frequency: ${mowingTypeMap[quote.mowingType] || quote.mowingType}`);
    }
    
    // Measurements
    if (quote.lawnSqft) lines.push(`Lawn size: ${quote.lawnSqft.toLocaleString()} sq ft`);
    if (quote.mulchSqft) {
        lines.push(`Mulch area: ${quote.mulchSqft.toLocaleString()} sq ft`);
        if (quote.mulchCuYards) lines.push(`Mulch volume: ${quote.mulchCuYards} cu yards`);
    }
    if (quote.mulchColor) {
        const colorMap = { 'red': 'Red', 'black': 'Black', 'brown': 'Brown' };
        lines.push(`Mulch color: ${colorMap[quote.mulchColor] || quote.mulchColor}`);
    }
    
    // Property access
    if (quote.hasGate) {
        let gateInfo = 'Gate: Yes';
        if (quote.gateWidth) gateInfo += ` (${quote.gateWidth}" wide)`;
        if (quote.gateCode) gateInfo += ` [Code: ${quote.gateCode}]`;
        lines.push(gateInfo);
    } else if (quote.hasGate === false) {
        lines.push('Gate: No');
    }
    
    if (quote.hasStairs === true) {
        lines.push('Stairs to backyard: Yes');
    } else if (quote.hasStairs === false) {
        lines.push('Stairs to backyard: No');
    }
    
    if (quote.hasDog === true) {
        lines.push('Dogs: Yes ⚠️');
    } else if (quote.hasDog === false) {
        lines.push('Dogs: No');
    }
    
    // Lawn condition
    if (quote.isOvergrown) {
        let overgrownInfo = 'Lawn condition: OVERGROWN ⚠️';
        if (quote.grassHeight) overgrownInfo += ` (${quote.grassHeight})`;
        lines.push(overgrownInfo);
    } else if (quote.isOvergrown === false) {
        lines.push('Lawn condition: Normal');
    }
    
    // Customer's additional notes
    if (quote.notes) {
        lines.push(`\nCustomer notes:\n${quote.notes}`);
    }
    
    return lines.join('\n');
}

/**
 * Create a customer in Copilot
 */
async function createCustomer(quote, config) {
    const { firstName, lastName } = parseName(quote.name);
    const address = parseAddress(quote.address);
    
    // Build customer-level notes (general info only)
    const notes = buildCustomerNotes(quote);
    
    // Get current date for sdate
    const now = new Date();
    const sdate = now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    
    // Full data matching the working curl request
    const data = {
        lat: '',
        lng: '',
        title_mr: 'no',
        number: '',
        firstname: firstName,
        lname: lastName,
        company_name: quote.name || 'New Lead',
        type: '1',  // Customer type
        'new-type': '',
        email: quote.email || '',
        mobile: (quote.phone || '').replace(/\D/g, ''),
        tagslist: '',
        phone: '',
        ccemail2: '',
        ccemail3: '',
        custom_source_id: quote.referralSource ? (COPILOT_SOURCE_MAP[quote.referralSource] || quote.referralSource) : '',
        invoice_delivery_preference: '1',
        is_tax_exempt: '1',
        discount: '',
        sdate: sdate,
        desc: notes,
        appliesTo: 'customers',
        c_id: '0',
        recoptions: 'd',
        daily_option: '0',
        daily_days_count: '',
        weekly_count: '1',
        monthly_option: '1',
        month_day: '1',
        month_count1: '1',
        month_day_number: 'first',
        month_week_day: 'mon',
        month_count2: '1',
        custom_inv_cust_settings: '1',
        custom_stamp_pdf_view: '1',
        custom_pastdue_terms: '30',
        custom_past_due_val: '0.00',
        custom_inv_due_date: '1',
        custom_credit_available_show: '1',
        custom_inv_notes: '',
        custom_inv_terms: '',
        temporaryUploadIds: '',
        tags: '',
        country: config.defaultCountry || 'US',
        street: address.street,
        street2: '',
        county: '',
        city: address.city,
        state: address.state || config.defaultState || 'CO',
        zip: address.zip
    };

    console.log('   📤 Creating customer in Copilot...');
    const result = await copilotPost('/customers/doAdd', data, config, 'https://secure.copilotcrm.com/customers/add');
    
    if (result.status && result.id) {
        console.log(`   ✅ Customer created: ID ${result.id}`);
        return { success: true, customerId: result.id };
    } else {
        console.log(`   ❌ Failed to create customer: ${result.errmsg || result.raw || 'Unknown error'}`);
        return { success: false, error: result.errmsg };
    }
}

/**
 * Create a property/asset for a customer
 */
async function createProperty(customerId, quote, config) {
    const address = parseAddress(quote.address);
    
    // Build property-specific notes with all service details
    const propertyNotes = buildPropertyNotes(quote);
    
    const data = {
        customer: customerId,
        asset_name: 'Primary',
        street: address.street,
        city: address.city,
        asset_state: address.state || config.defaultState || 'CO',
        zip: address.zip,
        asset_country: config.defaultCountry || 'US',
        assets_size: quote.lawnSqft || quote.turfSqft || '',
        desc: propertyNotes, // Property notes field
        appliesTo: 'assets'
    };

    console.log('   📤 Creating property in Copilot...');
    const result = await copilotPost('/assets/doAdd', data, config);
    
    if (result.status && result.id) {
        console.log(`   ✅ Property created: ID ${result.id}`);
        return { success: true, propertyId: result.id };
    } else {
        console.log(`   ❌ Failed to create property: ${result.errmsg || 'Unknown error'}`);
        return { success: false, error: result.errmsg };
    }
}

/**
 * Main function: Process a quote and create in Copilot
 */
async function processQuote(quote) {
    const config = loadConfig();
    
    if (!config.enabled) {
        console.log('   ⏭️  Copilot integration disabled');
        return { copilotEnabled: false };
    }

    const result = {
        copilotEnabled: true,
        customer: null,
        property: null
    };

    try {
        // Create customer
        if (config.autoCreateCustomer) {
            result.customer = await createCustomer(quote, config);
            
            // Create property if customer was created
            if (result.customer.success && config.autoCreateProperty) {
                result.property = await createProperty(result.customer.customerId, quote, config);
            }
        }
    } catch (e) {
        console.error('   ❌ Copilot error:', e.message);
        result.error = e.message;
    }

    return result;
}

/**
 * Send email to a customer via Copilot
 * @param {string} customerId - Copilot customer ID (NOT email address!)
 * @param {string} subject - Email subject
 * @param {string} htmlContent - HTML email body
 * @param {object} config - Optional config (loads from file if not provided)
 */
async function sendEmail(customerId, subject, htmlContent, config = null) {
    config = config || loadConfig();
    
    if (!config.enabled) {
        console.log('   ⏭️  Copilot integration disabled');
        return { success: false, error: 'Copilot disabled' };
    }

    const data = {
        co_id: '29', // No Mow Worries company ID
        'to_customer[]': customerId,
        type: 'email',
        subject: subject,
        content: htmlContent,
        emailcc: '',
        attach_doc: '0',
        attach_est: '0',
        attach_inv: '0',
    };

    console.log(`   📧 Sending email to customer ${customerId}...`);
    
    try {
        const result = await copilotPost('/emails/sendMail', data, config, 'https://secure.copilotcrm.com/emails/emails');
        
        if (result?.status === 'valid' || result?.success) {
            console.log(`   ✅ Email sent successfully`);
            return { success: true, result };
        } else {
            console.log(`   ❌ Email failed: ${result?.msg || result?.errmsg || 'Unknown error'}`);
            return { success: false, error: result?.msg || result?.errmsg || 'Unknown error', result };
        }
    } catch (e) {
        console.error('   ❌ Email error:', e.message);
        return { success: false, error: e.message };
    }
}

/**
 * Send SMS to a customer via Copilot
 * @param {string} customerId - Copilot customer ID
 * @param {string} message - SMS message text
 * @param {object} config - Optional config
 */
async function sendSms(customerId, message, config = null) {
    config = config || loadConfig();
    
    if (!config.enabled) {
        console.log('   ⏭️  Copilot integration disabled');
        return { success: false, error: 'Copilot disabled' };
    }

    const data = {
        id: customerId,
        msg: message,
        type: 'customer',
    };

    console.log(`   📱 Sending SMS to customer ${customerId}...`);
    
    try {
        const result = await copilotPost('/sms/index/sendMsg', data, config, 'https://secure.copilotcrm.com/sms');
        
        if (result?.status === 'sent' || result?.msg?.includes('successfully')) {
            console.log(`   ✅ SMS sent successfully`);
            return { success: true, result };
        } else {
            console.log(`   ❌ SMS failed: ${result?.msg || 'Unknown error'}`);
            return { success: false, error: result?.msg || 'Unknown error', result };
        }
    } catch (e) {
        console.error('   ❌ SMS error:', e.message);
        return { success: false, error: e.message };
    }
}

/**
 * Send quote confirmation email to new customer
 * @param {string} customerId - Copilot customer ID
 * @param {object} quote - Quote data
 * @param {object} config - Optional config
 */
async function sendQuoteConfirmationEmail(customerId, quote, config = null, snapshotPath = null) {
    const firstName = (quote.name || 'there').split(' ')[0];
    const services = normalizeServices(quote.services);
    const lawnSqft = quote.turfSqft || quote.lawnSqft;
    
    // Load map snapshot as base64 if available
    let mapImageBase64 = null;
    if (snapshotPath) {
        try {
            const fs = require('fs');
            if (fs.existsSync(snapshotPath)) {
                const imageBuffer = fs.readFileSync(snapshotPath);
                mapImageBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;
                console.log(`   🗺️  Map snapshot loaded for email (${Math.round(imageBuffer.length / 1024)}KB)`);
            }
        } catch (e) {
            console.log(`   ⚠️  Could not load map snapshot: ${e.message}`);
        }
    }
    
    const subject = 'Quote Request Received - No Mow Worries';
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 560px; margin: 0 auto; background: white; }
    .header { background: #2E7D32; color: white; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .content { padding: 32px 24px; }
    .greeting { font-size: 18px; margin-bottom: 16px; }
    .message { color: #444; margin-bottom: 24px; }
    
    .receipt { background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0; }
    .receipt-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-bottom: 16px; font-weight: 600; }
    .receipt-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e0e0e0; font-size: 14px; }
    .receipt-row:last-child { border-bottom: none; }
    .receipt-label { color: #666; }
    .receipt-value { font-weight: 500; color: #1a1a1a; }
    .services-list { margin: 0; padding: 0; list-style: none; }
    .services-list li { padding: 4px 0; font-size: 14px; color: #1a1a1a; }
    
    .next-steps { margin: 24px 0; }
    .next-steps h3 { font-size: 14px; font-weight: 600; margin: 0 0 12px 0; color: #1a1a1a; }
    .next-steps ul { margin: 0; padding-left: 20px; color: #444; }
    .next-steps li { margin-bottom: 8px; font-size: 14px; }
    
    .contact-box { background: #e8f5e9; border-radius: 8px; padding: 16px 20px; margin: 24px 0; text-align: center; }
    .contact-box p { margin: 0; font-size: 14px; color: #1a1a1a; }
    .contact-box a { color: #2E7D32; font-weight: 600; text-decoration: none; }
    
    .signature { margin-top: 24px; color: #444; font-size: 14px; }
    
    .footer { background: #f8f9fa; padding: 20px 24px; text-align: center; }
    .footer p { margin: 4px 0; font-size: 12px; color: #999; }
    .footer a { color: #2E7D32; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>No Mow Worries</h1>
    </div>
    <div class="content">
      <p class="greeting">Hi ${firstName},</p>
      <p class="message">Thanks for submitting a quote request! We've received your information and will get back to you shortly with a customized quote.</p>
      
      <div class="receipt">
        <div class="receipt-title">What We Received</div>
        <div class="receipt-row">
          <span class="receipt-label">Address</span>
          <span class="receipt-value">${quote.address || 'N/A'}</span>
        </div>
        ${lawnSqft ? `<div class="receipt-row">
          <span class="receipt-label">Lawn Size</span>
          <span class="receipt-value">${parseInt(lawnSqft).toLocaleString()} sq ft</span>
        </div>` : ''}
        <div class="receipt-row">
          <span class="receipt-label">Services</span>
          <span class="receipt-value">
            <ul class="services-list">
              ${services.map(s => `<li>${s}</li>`).join('')}
            </ul>
          </span>
        </div>
      </div>
      
      ${mapImageBase64 ? `
      <div style="margin: 24px 0; text-align: center;">
        <img src="${mapImageBase64}" alt="Your Property" style="max-width: 100%; border-radius: 8px; border: 1px solid #e0e0e0;" />
        <p style="margin-top: 8px; font-size: 12px; color: #666;">Your property location</p>
      </div>
      ` : ''}
      
      <div class="next-steps">
        <h3>What's Next</h3>
        <ul>
          <li>We'll review your property details and measurements</li>
          <li>You'll receive a detailed quote within 1-2 business days</li>
          <li>No obligation — just helpful information</li>
        </ul>
      </div>
      
      <div class="contact-box">
        <p>Questions? Reply to this email or call <a href="tel:7205038019">(720) 503-8019</a></p>
      </div>
      
      <div class="signature">
        <p>We look forward to helping you!</p>
        <p><strong>The No Mow Worries Team</strong></p>
      </div>
    </div>
    <div class="footer">
      <p>No Mow Worries Lawn Care</p>
      <p>Aurora, CO | (720) 503-8019</p>
      <p><a href="https://nomowworriesco.com">nomowworriesco.com</a></p>
    </div>
  </div>
</body>
</html>`;

    return sendEmail(customerId, subject, htmlContent, config);
}

module.exports = { 
    processQuote, 
    loadConfig,
    sendEmail,
    sendSms,
    sendQuoteConfirmationEmail,
    refreshToken,
    ensureFreshToken,
    isTokenExpiringSoon,
};
