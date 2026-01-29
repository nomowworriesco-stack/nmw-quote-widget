/**
 * Create estimate for existing customer
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
        
        // Format dates as MM/DD/YYYY
        const formatDate = (d) => `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
        
        const postData = new URLSearchParams({
            customer: customerId,
            asset_id: propertyId,
            e_num: '',
            date: formatDate(today),
            valid_date: formatDate(validDate),
            terms: '',
            notes: 'Thank you for requesting a quote! Please let us know if you have any questions.',
            discount: '0',
            tax: '0',
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
                'Referer': 'https://secure.copilotcrm.com/finances/estimates/add',
                'Content-Length': Buffer.byteLength(postStr)
            }
        };

        console.log('Request data:', postStr);
        
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log('Response status:', res.statusCode);
                console.log('Response:', body.substring(0, 2000));
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

createEstimate().then(console.log).catch(console.error);
