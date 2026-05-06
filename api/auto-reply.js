// /api/auto-reply — Autopilot: Instant response to customer inquiries
// Sends immediate auto-reply with FAQ + next steps, then notifies mom via SMS

import { kv } from '@vercel/kv';

const FAQ_RESPONSE = {
  en: `Hi! Thanks for contacting Paw Paw Pet Care. 

I'm Yan — I run a small home dog boarding in Castro Valley (10+ years experience).

QUICK ANSWERS:
📍 Location: Castro Valley, CA (94546)
💰 Rates: $35/day daycare, $50/night boarding (small dogs)
🐾 Capacity: Only 1-2 dogs at a time — personal attention guaranteed
📅 Availability: I usually book 1-2 weeks out
📋 Requirements: Current rabies, DHPP, Bordetella vaccines

NEXT STEPS:
I'll personally reply within a few hours. If it's urgent, text me at 415-823-0199.

For faster booking, you can also schedule a free meet-and-greet first so your dog can see the space.

Talk soon!
— Yan 🐾`,

  zh: `您好！感谢您联系 Paw Paw Pet Care。

我是 Yan，在 Castro Valley 提供家庭式狗狗寄养服务（10年以上经验）。

常见问题：
📍 地址：Castro Valley, CA (94546)
💰 价格：日托 $35/天，过夜 $50/晚（小型犬）
🐾 容量：每次只接收1-2只狗狗，保证个性化照顾
📅 预订：通常需要提前1-2周
📋 要求：需提供狂犬病、DHPP、犬咳疫苗证明

下一步：
我会在几个小时内亲自回复您。如有急事，请发短信至 415-823-0199。

也欢迎先预约免费见面，让您的狗狗熟悉环境。

期待为您服务！
— Yan 🐾`
};

async function sendSMS({ to, body }) {
  // Using Twilio if credentials available, otherwise log for now
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  
  if (!accountSid || !authToken) {
    console.log(JSON.stringify({ ev: 'sms_skipped', to, body: body.slice(0, 50), reason: 'no_twilio_credentials' }));
    return { sent: false, reason: 'no_credentials' };
  }
  
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      To: to,
      From: fromNumber,
      Body: body
    })
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`twilio_${res.status}: ${err.slice(0, 100)}`);
  }
  
  const data = await res.json();
  return { sent: true, sid: data.sid };
}

async function sendEmailReply({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(JSON.stringify({ ev: 'autoreply_email_skipped', to, reason: 'no_resend_key' }));
    return { sent: false };
  }
  
  const from = process.env.AUTOREPLY_FROM || 'Paw Paw Pet Care <onboarding@resend.dev>';
  
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to, subject, text, html })
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`resend_${res.status}: ${err.slice(0, 100)}`);
  }
  
  return { sent: true };
}

export default async function handler(req, res) {
  const trace = 'auto_' + Date.now().toString(36);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  
  const { customerEmail, customerPhone, customerName, lang, inquiryType } = req.body;
  
  if (!customerEmail && !customerPhone) {
    return res.status(400).json({ ok: false, error: 'missing_contact' });
  }
  
  try {
    // 1. Send auto-reply to customer
    const isChinese = lang === 'zh' || /[\u4e00-\u9fa5]/.test(customerName || '');
    const response = isChinese ? FAQ_RESPONSE.zh : FAQ_RESPONSE.en;
    
    const replyResults = [];
    
    // Email auto-reply
    if (customerEmail && customerEmail.includes('@')) {
      const emailResult = await sendEmailReply({
        to: customerEmail,
        subject: isChinese ? '自动回复：Paw Paw Pet Care 寄养咨询' : 'Auto-reply: Paw Paw Pet Care Inquiry',
        text: response,
        html: `<pre style="font-family: sans-serif; line-height: 1.6;">${response.replace(/\n/g, '<br>')}</pre>`
      });
      replyResults.push({ channel: 'email', ...emailResult });
    }
    
    // SMS auto-reply (if we have their phone)
    if (customerPhone) {
      const smsResult = await sendSMS({
        to: customerPhone,
        body: isChinese 
          ? `感谢您的咨询！我是Yan， Castro Valley家庭式狗狗寄养。价格：日托$35，过夜$50。我会尽快回复您。急事请短信415-823-0199。`
          : `Thanks for reaching out! I'm Yan, small home dog boarding in Castro Valley. Rates: $35/daycare, $50/overnight. I'll reply soon. Text 415-823-0199 for urgent.`
      });
      replyResults.push({ channel: 'sms', ...smsResult });
    }
    
    // 2. Notify mom via SMS (instant alert)
    const momPhone = process.env.MOM_PHONE || '14158230199';
    const momAlert = isChinese
      ? `📢 新咨询：${customerName || '新客户'} (${customerPhone || customerEmail}) 刚提交了寄养咨询。请查收邮件或尽快回复。`
      : `📢 New inquiry: ${customerName || 'New customer'} (${customerPhone || customerEmail}) just submitted. Check email or reply soon.`;
    
    const momNotification = await sendSMS({
      to: '+1' + momPhone.replace(/\D/g, ''),
      body: momAlert
    });
    
    // 3. Store in KV for follow-up tracking
    await kv.set(`inquiry:${trace}`, JSON.stringify({
      customerEmail,
      customerPhone,
      customerName,
      timestamp: Date.now(),
      autoReplied: true,
      momNotified: momNotification.sent,
      lang: isChinese ? 'zh' : 'en'
    }), { ex: 30 * 24 * 60 * 60 }); // 30 days
    
    // 4. Schedule follow-up reminder (if not replied within 4 hours)
    // This will be checked by a cron job (set up separately)
    await kv.set(`followup:${trace}`, JSON.stringify({
      customerEmail,
      customerPhone,
      customerName,
      inquiryTime: Date.now(),
      replyDeadline: Date.now() + (4 * 60 * 60 * 1000) // 4 hours
    }), { ex: 7 * 24 * 60 * 60 }); // 7 days
    
    console.log(JSON.stringify({
      trace,
      ev: 'autoreply_sent',
      customer: customerEmail || customerPhone,
      momNotified: momNotification.sent,
      channels: replyResults.map(r => r.channel)
    }));
    
    res.json({
      ok: true,
      trace,
      autoReplied: true,
      momNotified: momNotification.sent,
      customerChannels: replyResults.map(r => r.channel)
    });
    
  } catch (err) {
    console.error(JSON.stringify({ trace, ev: 'autoreply_error', error: err.message }));
    res.status(500).json({ ok: false, error: err.message, trace });
  }
}
