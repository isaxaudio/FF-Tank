const API_URL = process.env.FF_TANK_URL || 'http://localhost:3000';

async function testFirecrawl() {
  const response = await fetch(`${API_URL}/api/index?service=firecrawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'scrape',
      url: 'https://www.fatfishmedia.com',
      options: { onlyMainContent: true }
    })
  });

  const data = await response.json();
  console.log('Status:', response.status);
  console.log('Markdown length:', data.data?.markdown?.length);
  console.log('First 500 chars:', data.data?.markdown?.substring(0, 500));
}

testFirecrawl().catch(console.error);
