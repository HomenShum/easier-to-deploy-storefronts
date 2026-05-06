// Inbox Browser Test with Playwright
import { chromium } from 'playwright';

const INBOX_URL = 'https://<your-app>.vercel.app/inbox.html';
const API_KEY = process.env.ADMIN_API_KEY || 'development';

async function runTest() {
  console.log('🚀 Starting Inbox Browser Test\n');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  
  // Listen to console logs
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      console.log(`❌ Browser Console Error: ${text}`);
    } else if (text.includes('泡泡') || text.includes('inquiry') || text.includes('agent')) {
      console.log(`ℹ️  Browser: ${text}`);
    }
  });
  
  try {
    // Navigate to inbox
    console.log('📱 Navigating to inbox...');
    await page.goto(INBOX_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    
    // Take screenshot of login screen
    await page.screenshot({ path: 'test/inbox-1-login.png' });
    console.log('📸 Screenshot: inbox-1-login.png');
    
    // Login
    console.log('\n🔑 Logging in...');
    await page.fill('#api-key-input', API_KEY);
    await page.click('.login-btn');
    await page.waitForTimeout(2000);
    
    // Take screenshot after login
    await page.screenshot({ path: 'test/inbox-2-logged-in.png' });
    console.log('📸 Screenshot: inbox-2-logged-in.png');
    
    // Check for system message
    console.log('\n💬 Checking agent chat...');
    const chatMessages = await page.locator('.message-ai').count();
    console.log(`   Found ${chatMessages} agent messages`);
    
    // Get first agent message text
    if (chatMessages > 0) {
      const firstMsg = await page.locator('.message-ai').first().textContent();
      console.log(`   First message: "${firstMsg.substring(0, 80)}..."`);
      
      // Check for markdown (should be converted to HTML)
      const hasRawMarkdown = firstMsg.includes('**') || firstMsg.includes('__');
      if (hasRawMarkdown) {
        console.log('   ⚠️  WARNING: Raw markdown detected in agent message!');
      } else {
        console.log('   ✅ No raw markdown detected');
      }
    }
    
    // Check inquiry list
    console.log('\n📋 Checking inquiry list...');
    const inquiryCards = await page.locator('.inquiry-card').count();
    console.log(`   Found ${inquiryCards} inquiry cards`);
    
    if (inquiryCards > 0) {
      // Click first inquiry
      console.log('   Clicking first inquiry...');
      await page.locator('.inquiry-card').first().click();
      await page.waitForTimeout(1000);
      
      await page.screenshot({ path: 'test/inbox-3-detail-view.png' });
      console.log('📸 Screenshot: inbox-3-detail-view.png');
      
      // Check detail view
      const detailView = await page.locator('.detail-view').count();
      if (detailView > 0) {
        console.log('   ✅ Detail view opened successfully');
        
        // Check for reply form
        const replyForm = await page.locator('#reply-text').count();
        if (replyForm > 0) {
          console.log('   ✅ Reply form visible');
        }
      }
    }
    
    // Test agent chat
    console.log('\n🤖 Testing agent chat...');
    await page.fill('#chat-input', 'How many new inquiries do I have?');
    await page.press('#chat-input', 'Enter');
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: 'test/inbox-4-agent-chat.png' });
    console.log('📸 Screenshot: inbox-4-agent-chat.png');
    
    // Check for agent response
    const newChatMessages = await page.locator('.message-ai').count();
    console.log(`   Agent messages now: ${newChatMessages}`);
    
    if (newChatMessages > chatMessages) {
      const lastMsg = await page.locator('.message-ai').last().textContent();
      console.log(`   Agent response: "${lastMsg.substring(0, 100)}..."`);
      
      // Check markdown rendering
      const hasRawMarkdown = lastMsg.includes('**') || lastMsg.includes('__');
      if (hasRawMarkdown) {
        console.log('   ⚠️  WARNING: Raw markdown in agent response!');
      } else {
        console.log('   ✅ Agent response properly formatted');
      }
    }
    
    // Test refresh button
    console.log('\n🔄 Testing refresh button...');
    await page.click('button:has-text("刷新")');
    await page.waitForTimeout(2000);
    
    // Check for duplicate system messages
    const finalChatMessages = await page.locator('.message-ai').count();
    console.log(`   Agent messages after refresh: ${finalChatMessages}`);
    
    if (finalChatMessages === newChatMessages) {
      console.log('   ✅ No duplicate system message added');
    } else {
      console.log('   ⚠️  WARNING: Extra messages appeared after refresh!');
    }
    
    await page.screenshot({ path: 'test/inbox-5-after-refresh.png' });
    console.log('📸 Screenshot: inbox-5-after-refresh.png');
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Inquiries found: ${inquiryCards}`);
    console.log(`✅ Agent messages: ${finalChatMessages}`);
    console.log(`✅ Screenshots saved to test/ folder`);
    
    await browser.close();
    console.log('\n🎉 Test complete!');
    
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    await page.screenshot({ path: 'test/inbox-error.png' });
    console.log('📸 Error screenshot: inbox-error.png');
    await browser.close();
    process.exit(1);
  }
}

runTest();
