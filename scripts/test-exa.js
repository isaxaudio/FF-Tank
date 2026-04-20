const API_URL = process.env.FF_TANK_URL || 'http://localhost:3000';

async function testExa() {
  const response = await fetch(`${API_URL}/api/index?service=exa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: "Utah based SaaS company announces new CMO",
      options: {
        category: "news",
        numResults: 5,
        startPublishedDate: "2026-03-17"
      }
    })
  });

  const data = await response.json();
  console.log('Status:', response.status);
  console.log('Results:', JSON.stringify(data, null, 2));
}

testExa().catch(console.error);
