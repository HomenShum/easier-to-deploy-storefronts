// Quick agent test using native fetch
const URL = 'https://<your-app>.vercel.app/api/agent/%E6%B3%A1%E6%B3%A1';
const KEY = 'test';

async function test(name, msg, expect) {
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ message: msg, history: [] })
    });
    const data = await res.json();
    const pass = expect(data);
    console.log(pass ? '✅' : '❌', name, '|', data.response?.slice(0, 60) || data.error || 'empty');
    return { pass, data };
  } catch (e) {
    console.log('❌', name, '|', e.message);
    return { pass: false, error: e.message };
  }
}

console.log('Testing 泡泡 Paw Paw Agent...\n');

const r1 = await test('Auth works', 'hi', d => d.ok === true);
const r2 = await test('Has response', 'hello', d => (d.response?.length || 0) > 10);
const r3 = await test('Fallback works', '价格', d => d.fallback === true || d.response?.includes('$') || d.response?.includes('价格') || d.response?.includes('35'));
const r4 = await test('Not empty', '你好', d => (d.response?.length || 0) > 5);

console.log('\n---');
const passed = [r1, r2, r3, r4].filter(r => r.pass).length;
console.log(`Score: ${passed}/4 tests passed`);
