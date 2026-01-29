/**
 * Create estimate - use simple numeric doc number
 */

const https = require('https');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('./copilot-config.json', 'utf8'));

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
        
        const formatDate = (d) => {
            const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            return `${m[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
        };
        
        // Try simple incrementing number
        const docNum = '510';
        
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
        console.log('Request:', postStr.substring(0, 500));
        
        const options = {
            hostname: 'secure.copilotcrm.com',
            port: 443,
            path: '/finances/estimates/doAdd',
            method: 'POST',
            headers: {
                'Cookie': getCookieHeader(),
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Referer': 'https://secure.copilotcrm.com/finances/estimates/add?c_id=' + customerId,
                'Origin': 'https://secure.copilotcrm.com',
                'Content-Length': Buffer.byteLength(postStr)
            }
        };
        
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log('Status:', res.statusCode);
                console.log('Response:', body.substring(0, 1000));
            });
        });

        req.on('error', console.error);
        req.write(postStr);
        req.end();
    });
}

createEstimate();
