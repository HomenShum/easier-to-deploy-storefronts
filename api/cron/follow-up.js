// /api/cron/follow-up — Runs every hour to check for unreplied inquiries
// Sends reminder to mom if she hasn't replied within 4 hours
// Also sends gentle follow-up to customer after 24 hours

import { kv } from '@vercel/kv';

async function sendMomReminder({ customerName, customerContact, hoursAgo }) {
  const momPhone = process.env.MOM_PHONE || '14158230199';
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  
  if (!accountSid || !authToken) return { sent: false };
  
  const body = `⏰ 提醒：${customerName} (${customerContact}) ${hoursAgo}小时前咨询，您还未回复。客户可能正在等。请尽快查看邮件或短信回复。`;
  
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      To: '+1' + momPhone.replace(/\D/g, ''),
      From: fromNumber,
      Body: body
    })
  });
  
  return res.ok ? { sent: true } : { sent: false, error: await res.text() };
}

async function sendCustomerFollowUp({ email, name, lang }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !email) return { sent: false };
  
  const isChinese = lang === 'zh';
  const subject = isChinese 
    ? '跟進：Paw Paw Pet Care 寄养咨询'
    : 'Following up: Paw Paw Pet Care Inquiry';
  
  const body = isChinese
    ? `您好 ${name || ''}，

我想跟進一下您的寄養咨詢。我可能錯過了您的消息。

如果您還在尋找狗狗寄養，請直接發短信至 415-823-0199 或回復此郵件。

我通常會在幾個小時內回復。

謝謝！
Yan
Paw Paw Pet Care`
    : `Hi ${name || ''},

I wanted to follow up on your boarding inquiry. I may have missed your message.

If you're still looking for dog boarding, please text me at 415-823-0199 or reply to this email.

I typically reply within a few hours.

Thanks!
Yan
Paw Paw Pet Care`;
  
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Paw Paw Pet Care <onboarding@resend.dev>',
      to: email,
      subject,
      text: body
    })
  });
  
  return res.ok ? { sent: true } : { sent: false };
}

export default async function handler(req, res) {
  // Verify cron secret to prevent abuse
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  
  const now = Date.now();
  const results = { momReminders: 0, customerFollowUps: 0, errors: [] };
  
  try {
    // Get all pending follow-ups
    const keys = await kv.keys('followup:*');
    
    for (const key of keys) {
      try {
        const data = await kv.get(key);
        if (!data) continue;
        
        const inquiry = typeof data === 'string' ? JSON.parse(data) : data;
        const hoursSinceInquiry = (now - inquiry.inquiryTime) / (60 * 60 * 1000);
        
        // 4-hour reminder to mom (if not already reminded)
        if (hoursSinceInquiry >= 4 && hoursSinceInquiry < 5 && !inquiry.momReminded) {
          await sendMomReminder({
            customerName: inquiry.customerName || 'Customer',
            customerContact: inquiry.customerEmail || inquiry.customerPhone,
            hoursAgo: Math.floor(hoursSinceInquiry)
          });
          
          // Mark as reminded
          inquiry.momReminded = true;
          await kv.set(key, JSON.stringify(inquiry), { ex: 7 * 24 * 60 * 60 });
          results.momReminders++;
        }
        
        // 24-hour follow-up to customer (gentle nudge)
        if (hoursSinceInquiry >= 24 && hoursSinceInquiry < 25 && !inquiry.customerFollowedUp) {
          await sendCustomerFollowUp({
            email: inquiry.customerEmail,
            name: inquiry.customerName,
            lang: inquiry.lang
          });
          
          // Mark as followed up
          inquiry.customerFollowedUp = true;
          await kv.set(key, JSON.stringify(inquiry), { ex: 7 * 24 * 60 * 60 });
          results.customerFollowUps++;
        }
        
        // Clean up old entries (older than 7 days)
        if (hoursSinceInquiry > 168) { // 7 days
          await kv.del(key);
        }
        
      } catch (err) {
        results.errors.push({ key, error: err.message });
      }
    }
    
    console.log(JSON.stringify({
      ev: 'cron_followup',
      timestamp: now,
      ...results
    }));
    
    res.json({ ok: true, results });
    
  } catch (err) {
    console.error(JSON.stringify({ ev: 'cron_error', error: err.message }));
    res.status(500).json({ ok: false, error: err.message });
  }
}
