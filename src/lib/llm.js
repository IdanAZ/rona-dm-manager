function llmConfig(config) {
  const l = config?.llm || {};
  const provider = String(l.provider || process.env.LLM_PROVIDER || '').toLowerCase();
  const apiKey = l.apiKey || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '';
  let baseUrl = l.baseUrl || process.env.LLM_BASE_URL || '';
  if (!baseUrl) {
    if (provider === 'xai' || (!provider && process.env.XAI_API_KEY)) baseUrl = 'https://api.x.ai/v1';
    else baseUrl = 'https://api.openai.com/v1';
  }
  const model = l.model || process.env.LLM_MODEL || (provider === 'xai' || baseUrl.includes('x.ai') ? 'grok-4' : 'gpt-4o-mini');
  return {
    enabled: !!apiKey,
    provider: provider || (baseUrl.includes('x.ai') ? 'xai' : 'openai'),
    apiKey,
    baseUrl: String(baseUrl).replace(/\/$/, ''),
    model,
  };
}

async function chatCompletions(llm, { messages, tools, temperature = 0.4 } = {}, fetchImpl = fetch) {
  if (!llm?.apiKey) {
    const err = new Error('llm_not_configured');
    err.code = 'llm_not_configured';
    throw err;
  }
  const body = {
    model: llm.model,
    messages,
    temperature,
  };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const res = await fetchImpl(`${llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${llm.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(json?.error?.message || `LLM ${res.status}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  const choice = json.choices && json.choices[0];
  return {
    message: choice?.message || { role: 'assistant', content: '' },
    usage: json.usage || null,
    raw: json,
  };
}

module.exports = { llmConfig, chatCompletions };
