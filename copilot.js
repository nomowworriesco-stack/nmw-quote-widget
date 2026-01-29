/**
 * Copilot CRM Integration Module
 * Creates customers and properties from quote requests
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'copilot-config.json');

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
    
    // Split by comma
    const parts = address.split(',').map(p => p.trim());
    
    if (parts.length >= 1) {
        result.street = parts[0];
    }
    
    if (parts.length >= 2) {
        result.city = parts[1];
    }
    
    if (parts.length >= 3) {
        // Last part might be "CO 80015" or just "80015"
        const lastPart = parts[parts.length - 1];
        const stateZipMatch = lastPart.match(/([A-Z]{2})?\s*(\d{5})?/);
        if (stateZipMatch) {
            if (stateZipMatch[1]) result.state = stateZipMatch[1];
            if (stateZipMatch[2]) result.zip = stateZipMatch[2];
        }
    }
    
    return result;
}

/**
 * Create a customer in Copilot
 */
async function createCustomer(quote, config) {
    const { firstName, lastName } = parseName(quote.name);
    const address = parseAddress(quote.address);
    
    // Build service notes
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
    
    const servicesText = (quote.services || []).map(s => serviceNames[s] || s).join(', ');
    let notes = `Quote request from website.\nServices: ${servicesText}`;
    if (quote.turfSqft) notes += `\nLawn size: ${quote.turfSqft} sq ft`;
    if (quote.mulchSqft) notes += `\nMulch area: ${quote.mulchSqft} sq ft (${quote.mulchCuFt} cu ft)`;
    if (quote.notes) notes += `\nCustomer notes: ${quote.notes}`;
    
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
        custom_source_id: '',
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
    
    const data = {
        customer: customerId,
        asset_name: 'Primary',
        street: address.street,
        city: address.city,
        asset_state: address.state || config.defaultState || 'CO',
        zip: address.zip,
        asset_country: config.defaultCountry || 'US',
        assets_size: quote.turfSqft || '',
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
async function sendQuoteConfirmationEmail(customerId, quote, config = null) {
    const firstName = (quote.name || 'there').split(' ')[0];
    
    const subject = 'Quote Request Received - No Mow Worries';
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background: #2E7D32; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .footer { background: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌿 No Mow Worries</h1>
  </div>
  <div class="content">
    <p>Hi ${firstName}!</p>
    <p>Thanks for submitting a quote request! We've received your information and will get back to you shortly with a customized quote.</p>
    <p><strong>What's next?</strong></p>
    <ul>
      <li>We'll review your property details and measurements</li>
      <li>You'll receive a detailed quote within 1-2 business days</li>
      <li>No obligation - just helpful information!</li>
    </ul>
    <p>Have questions? Just reply to this email or call us at <strong>(720) 503-8019</strong>.</p>
    <p>We look forward to helping you with your lawn care needs!</p>
    <p>Best,<br>The No Mow Worries Team</p>
  </div>
  <div class="footer">
    <p>No Mow Worries Lawn Care | Aurora, CO | (720) 503-8019</p>
    <p><a href="https://nomowworriesco.com">nomowworriesco.com</a></p>
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
