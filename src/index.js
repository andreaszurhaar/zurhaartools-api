const PROMPTS = {
  'job-red-flags': `You are an expert career advisor. Analyze the following job posting and identify red flags that job seekers should be aware of.

For each red flag found, provide:
- The exact text from the posting
- What it likely means in practice
- A severity level: "high", "medium", or "low"

Also provide an overall score from 1-10 (1 = many red flags, 10 = looks great) and a one-sentence summary.

Common red flags to look for:
- Vague or missing salary information
- Unrealistic experience requirements
- "Fast-paced environment", "wear many hats", "like a family"
- Excessive requirements for the seniority level
- Unpaid overtime expectations disguised as "passion"
- "Other duties as assigned" with no clear role definition
- Requiring years of experience in new technologies

Respond in JSON format:
{
  "score": number,
  "summary": "string",
  "redFlags": [
    {
      "text": "exact quote from posting",
      "meaning": "what this likely means",
      "severity": "high|medium|low"
    }
  ],
  "greenFlags": [
    {
      "text": "exact quote from posting",
      "meaning": "why this is positive"
    }
  ]
}

Only respond with valid JSON, no other text.

Job posting to analyze:
`,

  'tos-scan': `You are a consumer rights expert. Analyze the following Terms of Service or Privacy Policy and identify clauses that are concerning for the user.

For each concerning clause, provide:
- The relevant text (summarized if very long)
- What it means in plain language
- A severity level: "high", "medium", or "low"

Also provide an overall privacy/fairness score from 1-10 (1 = very concerning, 10 = very fair) and a one-sentence summary.

Look for:
- Data selling or sharing with third parties
- Irrevocable content licenses
- Unilateral terms changes without notice
- Liability limitations
- Forced arbitration
- Auto-renewal traps
- Data retention policies
- Right to terminate without reason

Respond in JSON format:
{
  "score": number,
  "summary": "string",
  "concerns": [
    {
      "text": "relevant clause text",
      "meaning": "what this means for you",
      "severity": "high|medium|low"
    }
  ],
  "positives": [
    {
      "text": "relevant clause text",
      "meaning": "why this is good"
    }
  ]
}

Only respond with valid JSON, no other text.

Text to analyze:
`,
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // Scan endpoint
    if (url.pathname === '/api/scan' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { type, text } = body;

        // Validate request
        if (!type || !text) {
          return new Response(
            JSON.stringify({ error: 'Missing required fields: type, text' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
          );
        }

        const prompt = PROMPTS[type];
        if (!prompt) {
          return new Response(
            JSON.stringify({ error: `Unknown scan type: ${type}. Valid types: ${Object.keys(PROMPTS).join(', ')}` }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
          );
        }

        // Limit text length to control costs
        const maxLength = 15000;
        const trimmedText = text.length > maxLength ? text.substring(0, maxLength) + '\n\n[Text truncated]' : text;

        // Call Claude API
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            messages: [
              {
                role: 'user',
                content: prompt + trimmedText,
              },
            ],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Anthropic API error:', errorText);
          return new Response(
            JSON.stringify({ error: 'Analysis service temporarily unavailable' }),
            { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
          );
        }

        const result = await response.json();
        const content = result.content[0].text;

        // Parse the JSON response from Claude
        let parsed;
        try {
          // Strip markdown code blocks if present
          const cleaned = content.replace(/^```(?:json)?\n?/g, '').replace(/\n?```$/g, '').trim();
          parsed = JSON.parse(cleaned);
        } catch {
          // Try to extract JSON object from within the response
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            } else {
              parsed = { raw: content, error: 'Could not parse structured response' };
            }
          } catch {
            parsed = { raw: content, error: 'Could not parse structured response' };
          }
        }

        return new Response(JSON.stringify(parsed), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      } catch (err) {
        console.error('Request error:', err);
        return new Response(
          JSON.stringify({ error: 'Internal server error' }),
          { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
        );
      }
    }

    // 404 for everything else
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};
