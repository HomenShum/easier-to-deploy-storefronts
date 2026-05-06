// /api/agent/泡泡.js — 泡泡 Paw Paw Agent (simplified, working version)
// Uses OpenRouter kimi-k2.6 with function calling

import { kv } from '@vercel/kv';

// ============== BUSINESS DATA ==============
const BUSINESS_INFO = {
  name: 'Paw Paw Pet Care',
  owner: 'Yan',
  location: 'Castro Valley, CA 94546',
  phone: '415-823-0199',
  experience: '10+ years',
  capacity: '1-2 dogs at a time for personal attention',
  prices: {
    small: { daycare: '$35/day', overnight: '$50/night' },
    medium: { daycare: '$40-45/day', overnight: '$60-70/night' }
  },
  vaccines: ['Rabies (狂犬病)', 'DHPP', 'Bordetella (犬咳)'],
  features: ['Daily photo updates', 'Home environment', 'Individualized care', 'Free meet & greet'],
  requirements: 'Current vaccines, dog must be friendly with other dogs'
};

// ============== KV HELPER ==============
function kvAvailable() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function fetchInquiries(filter = 'all') {
  const useKV = kvAvailable();
  let inquiries = [];
  
  if (useKV) {
    try {
      const ids = await kv.lrange('inbox:all', 0, 49);
      for (const id of ids) {
        const data = await kv.get(`inquiry:${id}`);
        if (data) {
          const inquiry = typeof data === 'string' ? JSON.parse(data) : data;
          if (filter === 'new' && inquiry.replied) continue;
          if (filter === 'replied' && !inquiry.replied) continue;
          inquiries.push(inquiry);
        }
      }
    } catch (e) {
      console.error('KV fetch error:', e.message);
    }
  }
  
  // Demo data if empty
  if (inquiries.length === 0) {
    inquiries = [
      {
        id: 'demo_1',
        name: 'Sarah Johnson',
        contact: 'sarah@example.com',
        message: 'Hi! I need boarding for my Golden Retriever from July 15-20.',
        dog: 'Golden Retriever',
        dates: 'July 15-20',
        lang: 'en',
        timestamp: Date.now() - 3600000,
        replied: false
      },
      {
        id: 'demo_2', 
        name: '张先生',
        contact: 'zhang@example.com',
        message: '您好，我想咨询日托服务，我家泰迪下周需要照顾。',
        dog: '泰迪',
        dates: '下周',
        lang: 'zh',
        timestamp: Date.now() - 7200000,
        replied: false
      }
    ];
  }
  
  return inquiries.slice(0, 10);
}

async function getStats() {
  const useKV = kvAvailable();
  if (useKV) {
    try {
      return {
        total: parseInt(await kv.get('stats:total_inquiries') || '0'),
        unreplied: parseInt(await kv.get('stats:unreplied') || '0'),
        replied: parseInt(await kv.get('stats:total_replies') || '0'),
        demo: false
      };
    } catch (e) {
      console.error('Stats error:', e.message);
    }
  }
  return { total: 2, unreplied: 2, replied: 0, demo: true };
}

// ============== OPENROUTER LLM ==============
async function callOpenRouter(messages, useTools = false, attempt = 1) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }
  
  const systemPrompt = `You are 泡泡 Paw Paw (Bubble Paw Paw), Yan's AI assistant for Paw Paw Pet Care dog boarding business.

Business Details:
- Name: ${BUSINESS_INFO.name}
- Owner: ${BUSINESS_INFO.owner}
- Location: ${BUSINESS_INFO.location}  
- Phone: ${BUSINESS_INFO.phone}
- Experience: ${BUSINESS_INFO.experience}
- Capacity: ${BUSINESS_INFO.capacity}
- Prices: Small dogs ${BUSINESS_INFO.prices.small.daycare} daycare, ${BUSINESS_INFO.prices.small.overnight} overnight; Medium dogs ${BUSINESS_INFO.prices.medium.daycare} daycare, ${BUSINESS_INFO.prices.medium.overnight} overnight
- Required Vaccines: ${BUSINESS_INFO.vaccines.join(', ')}
- Features: ${BUSINESS_INFO.features.join(', ')}

You help Yan by:
1. Answering questions about the business in Chinese or English
2. Reporting how many new inquiries need replies
3. Summarizing what customers are asking about
4. Helping draft friendly responses

When users ask about "new inquiries", "咨询", "stats", "统计", use your tools to fetch real data.
Be warm, professional, and concise. Use emojis occasionally 🐾`;

  const tools = useTools ? [
    {
      type: 'function',
      function: {
        name: 'fetch_inquiries',
        description: 'Get customer inquiries from inbox',
        parameters: {
          type: 'object',
          properties: {
            filter: { type: 'string', enum: ['all', 'new', 'replied'], description: 'Filter inquiries' }
          },
          required: ['filter']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_business_stats',
        description: 'Get business statistics',
        parameters: { type: 'object', properties: {} }
      }
    }
  ] : undefined;

  // Try primary model, fallback to alternatives
  const models = ['moonshotai/kimi-k2.6', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini'];
  const model = models[Math.min(attempt - 1, models.length - 1)];
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://<your-app>.vercel.app',
      'X-Title': 'Paw Paw Pet Care Agent'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      ...(tools && { tools }),
      temperature: 0.7,
      max_tokens: 800
    })
  });
  
  if (response.status === 429 && attempt < 3) {
    // Rate limited, retry with backoff
    await new Promise(r => setTimeout(r, 1000 * attempt));
    return callOpenRouter(messages, useTools, attempt + 1);
  }
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter error: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Invalid LLM response structure');
  }
  
  return data.choices[0].message;
}

// ============== MAIN HANDLER ==============
export default async function handler(req, res) {
  const trace = '泡泡_' + Date.now().toString(36);
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  
  // Auth — fail closed if env not configured.
  const apiKey = String(req.headers['x-api-key'] || req.body?.apiKey || '').trim();
  const validKey = String(process.env.ADMIN_API_KEY || '').trim();
  if (!validKey || !apiKey || apiKey !== validKey) {
    console.log(JSON.stringify({ trace, ev: 'auth_failed' }));
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  
  const { message, history = [] } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ ok: false, error: 'missing_message' });
  }
  
  try {
    // Step 1: Initial LLM call with tools
    const messages = [...history, { role: 'user', content: message }];
    const llmResponse = await callOpenRouter(messages, true);
    
    let finalResponse = llmResponse.content || '';
    const toolResults = [];
    
    // Step 2: Handle tool calls
    if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
      console.log(JSON.stringify({ trace, ev: 'tool_calls', count: llmResponse.tool_calls.length }));
      
      for (const toolCall of llmResponse.tool_calls) {
        const { name, arguments: argsStr } = toolCall.function;
        const args = JSON.parse(argsStr || '{}');
        
        let result;
        if (name === 'fetch_inquiries') {
          result = await fetchInquiries(args.filter || 'all');
          toolResults.push({ tool: 'fetch_inquiries', result: { count: result.length } });
        } else if (name === 'get_business_stats') {
          result = await getStats();
          toolResults.push({ tool: 'get_business_stats', result });
        }
        
        // Add tool response to conversation
        messages.push({
          role: 'assistant',
          content: llmResponse.content || '',
          tool_calls: llmResponse.tool_calls
        });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }
      
      // Step 3: Get final response with tool results
      const finalLLM = await callOpenRouter(messages, false);
      finalResponse = finalLLM.content || finalResponse;
    }
    
    // If no real response or OpenRouter failed, provide fallback
    if (!finalResponse || finalResponse.length < 5 || finalResponse === 'undefined') {
      console.log(JSON.stringify({ trace, ev: 'fallback_triggered', reason: !finalResponse ? 'no_response' : 'too_short' }));
      finalResponse = generateFallback(message);
    }
    
    console.log(JSON.stringify({
      trace,
      ev: 'success',
      tools: toolResults.length,
      response_len: finalResponse.length
    }));
    
    res.json({
      ok: true,
      trace,
      response: finalResponse,
      tools: toolResults,
      history: [
        ...history,
        { role: 'user', content: message },
        { role: 'assistant', content: finalResponse }
      ]
    });
    
  } catch (err) {
    console.error(JSON.stringify({ trace, ev: 'error', error: err.message }));
    
    res.json({
      ok: true, // Soft fail for UX
      trace,
      response: generateFallback(message),
      error: err.message,
      fallback: true
    });
  }
}

// ============== FALLBACK RESPONSES ==============
function generateFallback(message) {
  const lower = message.toLowerCase();
  
  if (lower.includes('价格') || lower.includes('多少') || lower.includes('price') || lower.includes('cost')) {
    return `我们的价格是：
🐕 小型犬：日托 $35/天，过夜 $50/晚
🐕 中型犬：日托 $40-45/天，过夜 $60-70/晚

包含每日遛狗和照片更新！需要疫苗记录哦。`;
  }
  
  if (lower.includes('疫苗') || lower.includes('vaccine') || lower.includes('打针')) {
    return `需要以下疫苗记录：
💉 Rabies (狂犬病)
💉 DHPP (犬瘟热/细小病毒)
💉 Bordetella (犬咳)

请在寄养当天带上疫苗证明！`;
  }
  
  if (lower.includes('咨询') || lower.includes('inquir') || lower.includes('新') || lower.includes('stats')) {
    return `📬 目前有一些客户咨询等待回复。您可以点击右边的列表查看详情，或者问我具体的问题！`;
  }
  
  if (lower.includes('你好') || lower.includes('hi') || lower.includes('hello')) {
    return `您好！我是泡泡 Paw Paw 🐾 Yan的智能助手！

我可以帮您：
• 查看客户咨询
• 回答价格和疫苗问题
• 统计今天的业务量

有什么可以帮您的吗？`;
  }
  
  return `我是泡泡 Paw Paw，Yan的AI助手 🐾

我能帮您管理客户咨询、查询价格、了解疫苗要求等。

您可以直接问我：
• "价格是多少？"
• "需要什么疫苗？"
• "有多少新咨询？"
• "帮我查看收件箱"`;
}
