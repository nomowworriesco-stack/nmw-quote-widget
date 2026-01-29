/**
 * Create estimate - get next number first
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

function httpGet(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'secure.copilotcrm.com',
            port: 443,
            path: path,
            method: 'GET',
            headers: {
                'Cookie': getCookieHeader(),
                'Accept': 'application/json, text/html',
                'X-Requested-With': 'XMLHttpRequest'
            }
        };
        
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

async function getNextEstimateNumber() {
    // Try to get estimate add page which might have next number
    const result = await httpGet('/finances/estimates/getNextNumber');
    console.log('Next number API:', result.body.substring(0, 500));
    return result;
}

async function createEstimate(docNum) {
    return new Promise((resolve, reject) => {
        const today = new Date();
        const validDate = new Date(Date.now() + 30*24*60*60*1000);
        
        const formatDate = (d) => `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
        
        const postData = new URLSearchParams({
            customer: customerId,
            asset_id: propertyId,
            e_num: docNum,
            date: formatDate(today),
            valid_date: formatDate(validDate),
            terms: '',
            notes: 'Thank you for your interest in No Mow Worries! Reply to this email or call (720) 503-8019 with questions.',
            discount: '0',
            tax: '0',
            subtotal: (pricing.weeklyMowing + pricing.aeration).toString(),
            total: (pricing.weeklyMowing + pricing.aeration).toString()
        });
        
        // Add line items
        postData.append('srv_id[]', '');
        postData.append('qty[]', '1');
        postData.append('cost[]', pricing.weeklyMowing.toString());
        postData.append('desc[]', 'Weekly Lawn Mowing - Professional mowing, trimming, edging, and debris blowoff');
        
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
                console.log('Create estimate response:', res.statusCode);
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

async function main() {
    // Get next estimate number
    const nextNum = await getNextEstimateNumber();
    
    // Try with a generated number based on timestamp
    const docNum = 'EST-' + Date.now().toString().slice(-6);
    console.log('Using doc number:', docNum);
    
    const result = await createEstimate(docNum);
    console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
