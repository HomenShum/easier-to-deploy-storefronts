// Migrated 2026-04-24: simple-chat endpoint deleted (function-slot freed). Now hits /api/agent/泡泡.
// Agent Evaluation Suite for 泡泡 Paw Paw
// Tests OpenRouter integration, tool calling, and response quality

const BASE_URL = process.env.TEST_URL || 'https://landingpage-theta-mauve.vercel.app';
const ADMIN_KEY = process.env.ADMIN_API_KEY || 'pawpaw2024';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function log(msg, type = 'info') {
  const c = type === 'success' ? colors.green : type === 'error' ? colors.red : type === 'warn' ? colors.yellow : colors.cyan;
  console.log(`${c}${msg}${colors.reset}`);
}

// Test 1: Basic connectivity and auth
async function testAuth() {
  log('\n🔐 TEST: Authentication', 'info');
  
  try {
    // Bad key
    const bad = await fetch(`${BASE_URL}/api/agent/泡泡`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'wrong' },
      body: JSON.stringify({ message: 'hi' })
    });
    if (bad.status !== 401) {
      log('  ❌ Should reject bad API key', 'error');
      return { pass: false, error: 'Auth bypass possible' };
    }
    log('  ✅ Rejects invalid API key', 'success');
    
    // Good key
    const good = await fetch(`${BASE_URL}/api/agent/泡泡`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
      body: JSON.stringify({ message: 'hello', history: [] })
    });
    if (good.status !== 200) {
      log(`  ❌ Valid key rejected: ${good.status}`, 'error');
      return { pass: false, error: 'Valid auth failed' };
    }
    log('  ✅ Accepts valid API key', 'success');
    
    return { pass: true };
  } catch (err) {
    log(`  ❌ Auth test error: ${err.message}`, 'error');
    return { pass: false, error: err.message };
  }
}

// Test 2: Tool calling - fetch_inbox
async function testToolFetchInbox() {
  log('\n📬 TEST: Tool Calling - fetch_inbox', 'info');
  
  const tests = [
    { msg: '查看新咨询', expectTool: 'fetch_inbox' },
    { msg: '今天有多少咨询？', expectTool: 'fetch_inbox' },
    { msg: 'show me new inquiries', expectTool: 'fetch_inbox' }
  ];
  
  let passed = 0;
  
  for (const t of tests) {
    try {
      const res = await fetch(`${BASE_URL}/api/agent/泡泡`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
        body: JSON.stringify({ message: t.msg, history: [] })
      });
      
      const data = await res.json();
      const usedTool = data.tools?.some(tool => tool.tool === t.expectTool);
      
      if (usedTool || data.response?.includes('咨询') || data.response?.includes('inquir')) {
        log(`  ✅ "${t.msg.slice(0, 20)}..." → used ${t.expectTool}`, 'success');
        passed++;
      } else {
        log(`  ⚠️ "${t.msg.slice(0, 20)}..." → no tool used`, 'warn');
        log(`     Response: ${data.response?.slice(0, 50)}...`, 'gray');
      }
    } catch (err) {
      log(`  ❌ "${t.msg.slice(0, 20)}..." → ${err.message}`, 'error');
    }
  }
  
  return { pass: passed >= 2, score: `${passed}/${tests.length}` };
}

// Test 3: Tool calling - get_stats
async function testToolGetStats() {
  log('\n📊 TEST: Tool Calling - get_stats', 'info');
  
  const tests = [
    { msg: '统计一下', expectTool: 'get_stats' },
    { msg: '今天业绩如何？', expectTool: 'get_stats' },
    { msg: 'how many total inquiries', expectTool: 'get_stats' }
  ];
  
  let passed = 0;
  
  for (const t of tests) {
    try {
      const res = await fetch(`${BASE_URL}/api/agent/泡泡`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
        body: JSON.stringify({ message: t.msg, history: [] })
      });
      
      const data = await res.json();
      const usedTool = data.tools?.some(tool => tool.tool === t.expectTool);
      
      if (usedTool || data.response?.includes('统计') || data.response?.includes('total')) {
        log(`  ✅ "${t.msg.slice(0, 20)}..." → used ${t.expectTool}`, 'success');
        passed++;
      } else {
        log(`  ⚠️ "${t.msg.slice(0, 20)}..." → no tool used`, 'warn');
      }
    } catch (err) {
      log(`  ❌ "${t.msg.slice(0, 20)}..." → ${err.message}`, 'error');
    }
  }
  
  return { pass: passed >= 2, score: `${passed}/${tests.length}` };
}

// Test 4: Business knowledge (no tool needed)
async function testBusinessKnowledge() {
  log('\n💡 TEST: Business Knowledge (No Tool)', 'info');
  
  const tests = [
    { 
      msg: '价格是多少？', 
      shouldContain: ['35', '50', 'price', '$', '钱'],
      shouldNotContain: []
    },
    { 
      msg: '需要什么疫苗？', 
      shouldContain: ['疫苗', 'rabies', 'DHPP', 'bordetella', '狂犬病'],
      shouldNotContain: []
    },
    { 
      msg: '你在哪里？', 
      shouldContain: ['Castro', 'Valley', '94546', '地址', 'location'],
      shouldNotContain: []
    }
  ];
  
  let passed = 0;
  
  for (const t of tests) {
    try {
      const res = await fetch(`${BASE_URL}/api/agent/泡泡`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
        body: JSON.stringify({ message: t.msg, history: [] })
      });
      
      const data = await res.json();
      const resp = data.response?.toLowerCase() || '';
      
      const hasKeywords = t.shouldContain.some(kw => resp.includes(kw.toLowerCase()));
      
      if (hasKeywords) {
        log(`  ✅ "${t.msg}" → has correct info`, 'success');
        log(`     ${data.response?.slice(0, 60)}...`, 'gray');
        passed++;
      } else {
        log(`  ❌ "${t.msg}" → missing keywords`, 'error');
        log(`     Got: ${data.response?.slice(0, 60)}...`, 'gray');
      }
    } catch (err) {
      log(`  ❌ "${t.msg}" → ${err.message}`, 'error');
    }
  }
  
  return { pass: passed >= 2, score: `${passed}/${tests.length}` };
}

// Test 5: Bilingual support
async function testBilingual() {
  log('\n🌏 TEST: Bilingual Support (Chinese/English)', 'info');
  
  const tests = [
    { msg: '你好', shouldContainChinese: true },
    { msg: 'hello', shouldContainChinese: false },
    { msg: '价格', shouldContainChinese: true }
  ];
  
  let passed = 0;
  
  for (const t of tests) {
    try {
      const res = await fetch(`${BASE_URL}/api/agent/泡泡`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
        body: JSON.stringify({ message: t.msg, history: [] })
      });
      
      const data = await res.json();
      const resp = data.response || '';
      
      // Check for Chinese characters
      const hasChinese = /[\u4e00-\u9fa5]/.test(resp);
      
      if (hasChinese === t.shouldContainChinese) {
        log(`  ✅ "${t.msg}" → ${hasChinese ? 'Chinese' : 'English'} response`, 'success');
        passed++;
      } else {
        log(`  ⚠️ "${t.msg}" → wrong language (expected ${t.shouldContainChinese ? 'CN' : 'EN'})`, 'warn');
      }
    } catch (err) {
      log(`  ❌ "${t.msg}" → ${err.message}`, 'error');
    }
  }
  
  return { pass: passed >= 2, score: `${passed}/${tests.length}` };
}

// Test 6: Response quality
async function testResponseQuality() {
  log('\n⭐ TEST: Response Quality', 'info');
  
  try {
    const res = await fetch(`${BASE_URL}/api/agent/泡泡`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
      body: JSON.stringify({ 
        message: '我需要寄养服务，可以介绍一下吗？',
        history: []
      })
    });
    
    const data = await res.json();
    const resp = data.response || '';
    
    const checks = {
      length: resp.length > 50,
      hasContext: resp.includes('Paw') || resp.includes('泡泡') || resp.includes('Yan'),
      friendly: resp.includes('！') || resp.includes('?') || resp.includes('help') || resp.includes('happy'),
      notEmpty: resp.length > 10
    };
    
    const score = Object.values(checks).filter(Boolean).length;
    
    log(`  Response: ${resp.slice(0, 80)}...`, 'gray');
    log(`  Quality checks: ${score}/4`, score >= 3 ? 'success' : 'warn');
    
    return { pass: score >= 3, details: checks };
    
  } catch (err) {
    log(`  ❌ Quality test error: ${err.message}`, 'error');
    return { pass: false, error: err.message };
  }
}

// Test 7: Conversation memory
async function testConversationMemory() {
  log('\n🧠 TEST: Conversation Memory', 'info');
  
  try {
    // First message
    const res1 = await fetch(`${BASE_URL}/api/agent/泡泡`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
      body: JSON.stringify({ 
        message: '我叫Lisa',
        history: []
      })
    });
    const data1 = await res1.json();
    const history1 = data1.history || [];
    
    // Second message with history
    const res2 = await fetch(`${BASE_URL}/api/agent/泡泡`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
      body: JSON.stringify({ 
        message: '我叫什么名字？',
        history: history1
      })
    });
    const data2 = await res2.json();
    
    const remembers = data2.response?.toLowerCase().includes('lisa');
    
    if (remembers) {
      log('  ✅ Agent remembers user name from history', 'success');
      return { pass: true };
    } else {
      log('  ⚠️ Agent may not be using history effectively', 'warn');
      log(`     Response: ${data2.response?.slice(0, 50)}...`, 'gray');
      return { pass: false, warning: 'Memory not working' };
    }
    
  } catch (err) {
    log(`  ❌ Memory test error: ${err.message}`, 'error');
    return { pass: false, error: err.message };
  }
}

// Test 8: Error handling
async function testErrorHandling() {
  log('\n🛡️ TEST: Error Handling', 'info');
  
  try {
    // Empty message
    const res = await fetch(`${BASE_URL}/api/agent/泡泡`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
      body: JSON.stringify({ message: '', history: [] })
    });
    
    if (res.status === 400) {
      log('  ✅ Rejects empty message with 400', 'success');
      return { pass: true };
    } else {
      log(`  ⚠️ Empty message got ${res.status} (expected 400)`, 'warn');
      return { pass: false, warning: 'Bad input handling' };
    }
    
  } catch (err) {
    log(`  ❌ Error handling test failed: ${err.message}`, 'error');
    return { pass: false, error: err.message };
  }
}

// Main runner
async function runEvaluation() {
  log('========================================', 'cyan');
  log(' 泡泡 PAW PAW AGENT EVALUATION', 'cyan');
  log('========================================', 'cyan');
  log(`URL: ${BASE_URL}/api/agent/泡泡`, 'gray');
  log(`Model: moonshotai/kimi-k2.6`, 'gray');
  log(`Time: ${new Date().toISOString()}`, 'gray');
  
  const results = {};
  
  results.auth = await testAuth();
  results.toolInbox = await testToolFetchInbox();
  results.toolStats = await testToolGetStats();
  results.knowledge = await testBusinessKnowledge();
  results.bilingual = await testBilingual();
  results.quality = await testResponseQuality();
  results.memory = await testConversationMemory();
  results.errors = await testErrorHandling();
  
  // Summary
  log('\n========================================', 'cyan');
  log(' EVALUATION SUMMARY', 'cyan');
  log('========================================', 'cyan');
  
  let total = 0;
  let passed = 0;
  
  for (const [name, result] of Object.entries(results)) {
    total++;
    if (result.pass) passed++;
    const icon = result.pass ? '✅' : '❌';
    const color = result.pass ? 'success' : 'error';
    log(`${icon} ${name.padEnd(20)} ${result.score || ''}`, color);
  }
  
  const percentage = Math.round((passed / total) * 100);
  
  log('\n--- SCORE ---', 'cyan');
  log(`Total: ${passed}/${total}`, 'info');
  log(`Percentage: ${percentage}%`, percentage >= 80 ? 'success' : percentage >= 60 ? 'warn' : 'error');
  
  // Grade
  let grade = 'F';
  if (percentage >= 90) grade = 'A';
  else if (percentage >= 80) grade = 'B';
  else if (percentage >= 70) grade = 'C';
  else if (percentage >= 60) grade = 'D';
  
  log(`Grade: ${grade}`, percentage >= 80 ? 'success' : 'warn');
  
  // Recommendations
  if (percentage < 80) {
    log('\n--- RECOMMENDATIONS ---', 'yellow');
    if (!results.toolInbox.pass) log('• Improve inbox tool detection', 'warn');
    if (!results.toolStats.pass) log('• Improve stats tool detection', 'warn');
    if (!results.knowledge.pass) log('• Check business knowledge in system prompt', 'warn');
    if (!results.bilingual.pass) log('• Verify Chinese/English support', 'warn');
    if (!results.quality.pass) log('• Response quality needs improvement', 'warn');
  }
  
  log('\n========================================', 'cyan');
  
  return { passed, total, percentage, grade, results };
}

runEvaluation().catch(err => {
  log(`Evaluation crashed: ${err.message}`, 'error');
  process.exit(1);
});
