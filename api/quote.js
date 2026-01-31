// Vercel serverless function to proxy quote requests to local server via Cloudflare tunnel
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Get the backend URL from environment variable
  const backendUrl = process.env.BACKEND_URL;
  
  if (!backendUrl) {
    console.error('BACKEND_URL not configured');
    return res.status(500).json({ error: 'Backend not configured' });
  }
  
  try {
    const response = await fetch(`${backendUrl}/api/quote-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    
    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Failed to submit request. Please try again.' });
  }
}
