async function testLiveSignup() {
  const testEmail = `testuser_${Date.now()}@gmail.com`;
  console.log(`Testing signup with email: ${testEmail}`);
  try {
    const res = await fetch('https://backend-fkfj.onrender.com/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        name: 'Test User',
        phone: '1234567890',
        password: 'Password123'
      }),
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Response body:', text);
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

testLiveSignup();
