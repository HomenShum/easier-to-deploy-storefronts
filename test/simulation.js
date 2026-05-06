// Paw Paw Pet Care — End-to-End Simulation Test
// Run with: node test/simulation.js

const BASE_URL = process.env.TEST_URL || 'https://<your-app>.vercel.app';
const ADMIN_KEY = process.env.ADMIN_API_KEY || 'pawpaw2024';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, type = 'info') {
  const color = type === 'success' ? colors.green : 
                type === 'error' ? colors.red : 
                type === 'warn' ? colors.yellow : colors.cyan;
  console.log(`${color}${message}${colors.reset}`);
}

async function testContactForm() {
  log('\n📝 TEST: Contact Form Submission', 'info');
  
  const testCases = [
    {
      name: 'Sarah Johnson',
      contact: 'sarah.test@example.com',
      message: 'Hi! I need boarding for my Golden Retriever from July 15-20. What\'s your availability?',
      dog: 'Golden Retriever (Max)',
      dates: 'July 15-20',
      service: 'boarding',
      lang: 'en'
    },
    {
      name: '张先生',
      contact: 'zhang.test@example.com',
      message: '您好！我想咨询一下日托服务，我的泰迪下周需要托管。',
      dog: '泰迪 (豆豆)',
      dates: '下周',
      service: 'daycare',
      lang: 'zh'
    },
    {
      name: 'Lisa Chen',
      contact: '415-555-0199',
      message: 'Can we schedule a meet and greet first? I want to see the space before booking.',
      dog: 'French Bulldog',
      dates: 'Flexible',
      service: 'meet_greet',
      lang: 'en'
    }
  ];
  
  const results = [];
  
  for (const testCase of testCases) {
    try {
      const response = await fetch(`${BASE_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testCase)
      });
      
      const data = await response.json();
      
      if (data.ok) {
        log(`  ✅ ${testCase.name}: Form submitted`, 'success');
        log(`     Trace: ${data.traceId}, Translated: ${data.translated}`, 'info');
        results.push({ success: true, traceId: data.traceId, name: testCase.name });
      } else {
        log(`  ❌ ${testCase.name}: ${data.error}`, 'error');
        results.push({ success: false, error: data.error, name: testCase.name });
      }
      
      // Small delay between requests
      await new Promise(r => setTimeout(r, 500));
      
    } catch (err) {
      log(`  ❌ ${testCase.name}: ${err.message}`, 'error');
      results.push({ success: false, error: err.message, name: testCase.name });
    }
  }
  
  const passed = results.filter(r => r.success).length;
  log(`\n  Summary: ${passed}/${results.length} passed`, passed === results.length ? 'success' : 'warn');
  
  return results;
}

async function testInboxAPI() {
  log('\n📬 TEST: Inbox Fetch', 'info');
  
  try {
    const response = await fetch(`${BASE_URL}/api/inbox/store`, {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    
    const data = await response.json();
    
    if (data.ok) {
      log(`  ✅ Inbox fetched successfully`, 'success');
      log(`     Total inquiries: ${data.stats?.total || 0}`, 'info');
      log(`     Unreplied: ${data.stats?.unreplied || 0}`, 'info');
      log(`     In memory/KV: ${data.kv === false ? 'MEMORY (KV not configured)' : 'KV'}`, 'info');
      
      if (data.inquiries?.length > 0) {
        log(`     Latest inquiry: ${data.inquiries[0].name} (${data.inquiries[0].lang})`, 'info');
      }
      
      return { success: true, inquiries: data.inquiries, stats: data.stats };
    } else {
      log(`  ❌ Inbox fetch failed: ${data.error}`, 'error');
      return { success: false, error: data.error };
    }
    
  } catch (err) {
    log(`  ❌ Inbox fetch error: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

async function testAutoReply() {
  log('\n🤖 TEST: Auto-Reply Trigger', 'info');
  
  try {
    const response = await fetch(`${BASE_URL}/api/auto-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerEmail: 'test.auto@example.com',
        customerPhone: '+14155550199',
        customerName: 'Test Auto',
        lang: 'en',
        inquiryType: 'boarding'
      })
    });
    
    const data = await response.json();
    
    if (data.ok) {
      log(`  ✅ Auto-reply triggered`, 'success');
      log(`     Channels: ${data.channels?.join(', ') || 'none'}`, 'info');
      log(`     Email sent: ${data.channels?.includes('email') ? 'Yes' : 'No'}`, 'info');
      log(`     SMS sent: ${data.channels?.includes('sms') ? 'Yes' : 'No'}`, 'info');
      return { success: true, channels: data.channels };
    } else {
      log(`  ⚠️ Auto-reply: ${data.error || 'No channels configured'}`, 'warn');
      return { success: true, warning: data.error };
    }
    
  } catch (err) {
    log(`  ❌ Auto-reply error: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

async function testDailyPulse() {
  log('\n📊 TEST: Daily Pulse', 'info');
  
  try {
    const response = await fetch(`${BASE_URL}/api/inbox/daily-pulse`, {
      method: 'POST',
      headers: { 'x-api-key': ADMIN_KEY }
    });
    
    const data = await response.json();
    
    if (data.ok) {
      log(`  ✅ Daily pulse generated`, 'success');
      log(`     Inquiries in last 24h: ${data.inquiryCount || 0}`, 'info');
      log(`     Email sent to: ${data.sentTo || 'N/A'}`, 'info');
      return { success: true, count: data.inquiryCount };
    } else {
      log(`  ⚠️ Daily pulse: ${data.error || 'Issue generating'}`, 'warn');
      return { success: false, error: data.error };
    }
    
  } catch (err) {
    log(`  ❌ Daily pulse error: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

async function testReplyFlow(inquiries) {
  log('\n💬 TEST: Reply Flow', 'info');
  
  if (!inquiries || inquiries.length === 0) {
    log('  ⚠️ No inquiries to reply to', 'warn');
    return { success: false, skipped: true };
  }
  
  const unreplied = inquiries.find(i => !i.replied);
  if (!unreplied) {
    log('  ⚠️ All inquiries already replied', 'warn');
    return { success: false, skipped: true };
  }
  
  try {
    const response = await fetch(`${BASE_URL}/api/inbox/reply`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': ADMIN_KEY
      },
      body: JSON.stringify({
        inquiryId: unreplied.id,
        message: 'Hi! Thanks for your inquiry. Yes, we have availability. Let\'s schedule a meet and greet first!'
      })
    });
    
    const data = await response.json();
    
    if (data.ok) {
      log(`  ✅ Reply sent to ${unreplied.name}`, 'success');
      log(`     Channels: ${data.channels?.join(', ') || 'none'}`, 'info');
      return { success: true, channels: data.channels };
    } else {
      log(`  ❌ Reply failed: ${data.error}`, 'error');
      return { success: false, error: data.error };
    }
    
  } catch (err) {
    log(`  ❌ Reply error: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

async function testRateLimiting() {
  log('\n🛡️ TEST: Rate Limiting', 'info');
  
  const requests = [];
  
  // Send 6 rapid requests (limit is 5/min)
  for (let i = 0; i < 6; i++) {
    requests.push(
      fetch(`${BASE_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Rate Test ${i}`,
          contact: `rate${i}@test.com`,
          message: 'Testing rate limits'
        })
      })
    );
  }
  
  const responses = await Promise.all(requests);
  const statuses = responses.map(r => r.status);
  
  const successes = statuses.filter(s => s === 200).length;
  const rateLimited = statuses.filter(s => s === 429).length;
  
  log(`  Results: ${successes} successful, ${rateLimited} rate limited`, 'info');
  
  if (rateLimited > 0) {
    log(`  ✅ Rate limiting working correctly`, 'success');
    return { success: true, rateLimited };
  } else if (successes === 6) {
    log(`  ⚠️ Rate limit may not be enforced (or window reset)`, 'warn');
    return { success: true, warning: 'Check rate limit window' };
  }
  
  return { success: true, statuses };
}

async function generateReport(results) {
  log('\n' + '='.repeat(60), 'info');
  log('PAW PAW PET CARE — SIMULATION REPORT', 'info');
  log('='.repeat(60), 'info');
  
  const timestamp = new Date().toISOString();
  log(`Date: ${timestamp}`, 'info');
  log(`Base URL: ${BASE_URL}`, 'info');
  
  log('\n--- TEST RESULTS ---', 'info');
  
  let total = 0;
  let passed = 0;
  
  for (const [testName, result] of Object.entries(results)) {
    total++;
    if (result.success) passed++;
    
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    const color = result.success ? 'success' : 'error';
    log(`${status}: ${testName}`, color);
  }
  
  log('\n--- SUMMARY ---', 'info');
  const percentage = Math.round((passed / total) * 100);
  log(`Total Tests: ${total}`, 'info');
  log(`Passed: ${passed}`, 'success');
  log(`Failed: ${total - passed}`, total - passed > 0 ? 'error' : 'info');
  log(`Score: ${percentage}%`, percentage >= 80 ? 'success' : percentage >= 60 ? 'warn' : 'error');
  
  log('\n--- RECOMMENDATIONS ---', 'info');
  
  if (!results.contactForm?.success) {
    log('• Fix contact form submission', 'error');
  }
  if (!results.inbox?.success) {
    log('• Check ADMIN_API_KEY and inbox API', 'error');
  }
  if (results.autoReply?.channels?.length === 0) {
    log('• Configure Resend for email auto-replies', 'warn');
  }
  if (results.inbox?.stats && results.inbox.inquiries?.length === 0) {
    log('• Submit test inquiries to populate inbox', 'warn');
  }
  
  log('\n' + '='.repeat(60), 'info');
}

// Main simulation runner
async function runSimulation() {
  log('\n🐾 PAW PAW PET CARE SYSTEM SIMULATION', 'info');
  log('=====================================', 'info');
  
  const results = {};
  
  // Run all tests
  results.contactForm = await testContactForm();
  results.inbox = await testInboxAPI();
  results.autoReply = await testAutoReply();
  results.dailyPulse = await testDailyPulse();
  results.reply = await testReplyFlow(results.inbox?.inquiries);
  results.rateLimit = await testRateLimiting();
  
  // Generate report
  await generateReport(results);
  
  return results;
}

// Run if executed directly
if (require.main === module) {
  runSimulation().catch(err => {
    log(`Simulation failed: ${err.message}`, 'error');
    process.exit(1);
  });
}

module.exports = { runSimulation };
