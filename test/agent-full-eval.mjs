// Full Agent Evaluation for 泡泡 Paw Paw
const URL = 'https://<your-app>.vercel.app/api/agent/%E6%B3%A1%E6%B3%A1';
const KEY = 'test';

async function test(name, msg) {
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ message: msg, history: [] })
    });
    const data = await res.json();
    return { ok: data.ok, response: data.response, tools: data.tools, fallback: data.fallback, error: data.error };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

console.log('泡泡 PAW PAW AGENT EVALUATION\n' + '='.repeat(50) + '\n');

// 1. Chinese greeting
const r1 = await test('Chinese greeting', '你好');
console.log('1. Chinese Greeting');
console.log('   Status:', r1.ok ? '✅' : '❌');
console.log('   Response:', r1.response?.slice(0, 80) + '...');
console.log('   Has Chinese:', /[\u4e00-\u9fa5]/.test(r1.response) ? '✅' : '❌');
console.log('   Has emoji:', /🐾/.test(r1.response) ? '✅' : '❌');
console.log();

// 2. Pricing query
const r2 = await test('Pricing', '价格是多少？');
console.log('2. Pricing Query');
console.log('   Status:', r2.ok ? '✅' : '❌');
console.log('   Response:', r2.response?.slice(0, 80) + '...');
console.log('   Has price info:', r2.response?.includes('35') || r2.response?.includes('50') ? '✅' : '❌');
console.log();

// 3. Vaccine query
const r3 = await test('Vaccines', '需要什么疫苗？');
console.log('3. Vaccine Query');
console.log('   Status:', r3.ok ? '✅' : '❌');
console.log('   Response:', r3.response?.slice(0, 80) + '...');
console.log('   Has vaccine info:', r3.response?.includes('疫苗') || r3.response?.includes('Rabies') || r3.response?.includes('DHPP') ? '✅' : '❌');
console.log();

// 4. English query
const r4 = await test('English', 'What are your prices?');
console.log('4. English Query');
console.log('   Status:', r4.ok ? '✅' : '❌');
console.log('   Response:', r4.response?.slice(0, 80) + '...');
console.log('   English response:', /^[\x00-\x7F\s]+$/.test(r4.response?.slice(0, 50)) ? '✅' : '⚠️ mixed');
console.log();

// 5. Stats/inquiries
const r5 = await test('Stats', '今天有多少新咨询？');
console.log('5. Stats/Inquiries');
console.log('   Status:', r5.ok ? '✅' : '❌');
console.log('   Response:', r5.response?.slice(0, 80) + '...');
console.log('   Tools used:', r5.tools?.length || 0);
console.log('   Fallback:', r5.fallback ? '⚠️ fallback' : '✅ LLM');
console.log();

// 6. Error handling
const r6 = await test('Auth fail', 'test');
console.log('6. Error Handling (this is from cache, check auth separately)');
console.log('   Status:', r6.ok ? '✅' : '❌');
console.log();

// Summary
const all = [r1, r2, r3, r4, r5];
const passed = all.filter(r => r.ok && !r.error).length;
const hasContent = all.filter(r => (r.response?.length || 0) > 20).length;
const hasChinese = [r1, r2, r3].filter(r => /[\u4e00-\u9fa5]/.test(r.response)).length;
const hasEnglish = /[a-zA-Z]/.test(r4.response) ? 1 : 0;

console.log('='.repeat(50));
console.log('SUMMARY');
console.log('='.repeat(50));
console.log(`API Response:     ${passed}/5 OK`);
console.log(`Has Content:      ${hasContent}/5 meaningful responses`);
console.log(`Chinese Support:  ${hasChinese}/3 queries`);
console.log(`English Support:  ${hasEnglish}/1 query`);
console.log(`Model:            moonshotai/kimi-k2.6 (via OpenRouter)`);
console.log(`Fallback Mode:    ${r1.fallback ? 'Yes (API issue)' : 'No (LLM working)'}`);
console.log();
console.log('GRADE:', passed >= 4 ? 'A' : passed >= 3 ? 'B' : passed >= 2 ? 'C' : 'F');
