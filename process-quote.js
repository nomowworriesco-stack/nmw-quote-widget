/**
 * Process a quote request - create customer, property, and estimate
 */

const { processQuote, loadConfig, sendEmail } = require('./copilot.js');
const https = require('https');

// Quote data from webhook
const quote = {
    name: 'jimmy the beast',
    email: 'chrisxhagerman@gmail.com',
    phone: '7128990494',
    address: '19082 E CHENANGO CIR, Aurora, CO',
    services: ['mowing', 'aeration'],
    turfSqft: '1500',
    notes: '1500 sqft',
    source: 'google'
};

// Pricing based on 1500 sqft (<3000 sqft tier)
const pricing = {
    weeklyMowing: 40,  // $35-45 range, middle value
    aeration: 85       // $85-150 range, small lawn
};

function getCookieHeader(config) {
    const { cookies } = config;
    return `instantinvoices=${cookies.instantinvoices}; copilotApiAccessToken=${cookies.copilotApiAccessToken}`;
}

/**
 * Search for existing customer by email or phone
 */
async function searchCustomer(query, config) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'secure.copilotcrm.com',
            port: 443,
            path: `/search/global?q=${encodeURIComponent(query)}`,
            method: 'GET',
            headers: {
                'Cookie': getCookieHeader(config),
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
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
                    resolve({ error: 'Parse error', raw: body.substring(0, 500) });
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

/**
 * Create estimate in Copilot
 */
async function createEstimate(customerId, propertyId, config) {
    return new Promise((resolve, reject) => {
        // Build estimate line items
        const items = [
            {
                name: 'Weekly Lawn Mowing',
                description: 'Professional mowing, trimming, edging, and debris blowoff',
                qty: 1,
                price: pricing.weeklyMowing,
                serviceId: '' // Will need to look up service IDs
            },
            {
                name: 'Core Aeration',
                description: 'Core aeration service to improve lawn health',
                qty: 1,
                price: pricing.aeration,
                serviceId: ''
            }
        ];

        const total = items.reduce((sum, item) => sum + (item.qty * item.price), 0);

        // Create estimate via POST
        const postData = new URLSearchParams({
            c_id: customerId,
            asset_id: propertyId || '0',
            e_num: '', // Auto-generate
            date: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
            valid_date: new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
            terms: '',
            notes: 'Thank you for requesting a quote! Please let us know if you have any questions.',
            discount: '0',
            tax: '0',
            'srv_id[]': '',
            'qty[]': '1',
            'cost[]': pricing.weeklyMowing.toString(),
            'desc[]': 'Weekly Lawn Mowing - Professional mowing, trimming, edging, and debris blowoff (1500 sqft lawn)',
        }).toString();

        // Add second item
        const postData2 = postData + '&srv_id[]=&qty[]=1&cost[]=' + pricing.aeration + '&desc[]=Core Aeration - Improve water and nutrient absorption';

        const options = {
            hostname: 'secure.copilotcrm.com',
            port: 443,
            path: '/finances/estimates/doAdd',
            method: 'POST',
            headers: {
                'Cookie': getCookieHeader(config),
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json',
                'Referer': 'https://secure.copilotcrm.com/finances/estimates/add',
                'Content-Length': Buffer.byteLength(postData2)
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
                    resolve({ error: 'Parse error', raw: body.substring(0, 1000) });
                }
            });
        });

        req.on('error', reject);
        req.write(postData2);
        req.end();
    });
}

async function main() {
    console.log('🔄 Processing quote request...');
    console.log('   Name:', quote.name);
    console.log('   Email:', quote.email);
    console.log('   Address:', quote.address);
    console.log('   Services:', quote.services.join(', '));
    console.log('   Sqft:', quote.turfSqft);
    console.log('');

    const config = loadConfig();
    if (!config.enabled) {
        console.log('❌ Copilot integration is disabled');
        return;
    }

    // First search for existing customer
    console.log('🔍 Searching for existing customer...');
    const searchResult = await searchCustomer(quote.email, config);
    console.log('Search result:', JSON.stringify(searchResult, null, 2));

    // Process quote (create customer + property)
    console.log('\n📝 Creating customer and property...');
    const result = await processQuote(quote);
    console.log('Result:', JSON.stringify(result, null, 2));

    if (result.customer?.success) {
        console.log(`\n✅ Customer created: ID ${result.customer.customerId}`);
        
        if (result.property?.success) {
            console.log(`✅ Property created: ID ${result.property.propertyId}`);
        }

        // Create estimate
        console.log('\n💰 Creating estimate...');
        console.log(`   Weekly Mowing: $${pricing.weeklyMowing}`);
        console.log(`   Aeration: $${pricing.aeration}`);
        console.log(`   Total: $${pricing.weeklyMowing + pricing.aeration}`);
        
        const estimateResult = await createEstimate(
            result.customer.customerId, 
            result.property?.propertyId, 
            config
        );
        console.log('Estimate result:', JSON.stringify(estimateResult, null, 2));
    }
}

main().catch(console.error);
