/**
 * Create estimate for existing customer - try with auto doc number
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'copilot-config.json'), 'utf8'));

function getCookieHeader() {
    return `instantinvoices=${config.cookies.instantinvoices}; copilotApiAccessToken=${config.cookies.copilotApiAccessToken}`;
}

const customerId = '2343724';
const propertyId = '2225884';
const pricing = {
    weeklyMowing: 40,
    aeration: 85
};

async function createEstimate() {
    return new Promise((resolve, reject) => {
        const today = new Date();
        const validDate = new Date(Date.now() + 30*24*60*60*1000);
        
        // Format dates as M/D/YYYY like Copilot expects
        const formatDate = (d) => `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
        
        // Try with auto_number enabled
        const postData = new URLSearchParams({
            customer: customerId,
            asset_id: propertyId,
            e_num: 'AUTO',  // Try auto
            auto_number: '1',  // Enable auto-numbering
            date: formatDate(today),
            valid_date: formatDate(validDate),
            terms: '',
            notes: 'Thank you for requesting a quote from No Mow Worries! Please let us know if you have any questions.',
            discount: '0',
            tax: '0',
            add: '1'  // Indicate we're adding
        });
        
        // Add line items
        postData.append('srv_id[]', '');
        postData.append('qty[]', '1');
        postData.append('cost[]', pricing.weeklyMowing.toString());
        postData.append('desc[]', 'Weekly Lawn Mowing - Professional mowing, trimming, edging, and debris blowoff (1500 sqft lawn)');
        
        postData.append('srv_id[]', '');
        postData.append('qty[]', '1');
        postData.append('cost[]', pricing.aeration.toString());
        postData.append('desc[]', 'Core Aeration - Improve water and nutrient absorption');

        const postStr = postData.toString();
        
        const options = {
            hostname: 'secure.copilotcrm.com',
            port: 443,
            path: '/finances/estimates/doAdd',
            method: 'POST',
            headers: {
                'Cookie': getCookieHeader(),
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json',
                'Referer': 'https://secure.copilotcrm.com/finances/estimates/add?c_id=' + customerId,
                'Content-Length': Buffer.byteLength(postStr)
            }
        };
        
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log('Response status:', res.statusCode);
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    resolve({ error: 'Parse error', raw: body.substring(0, 2000) });
                }
            });
        });

        req.on('error', reject);
        req.write(postStr);
        req.end();
    });
}

createEstimate().then(r => console.log(JSON.stringify(r, null, 2))).catch(console.error);
