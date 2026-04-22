// Maps scan types to product names in the licenses table
const PRODUCT_FOR_TYPE = {
  'job-red-flags': 'job-red-flag-detector',
  'tos-scan': 'tos-scanner',
};

// Maps LemonSqueezy variant IDs to credit amounts
// Update these after creating products in LemonSqueezy
const CREDIT_BUNDLES = {
  // 'variant_id_here': 20,
  // 'variant_id_here': 50,
  // 'variant_id_here': 150,
};

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

async function verifyWebhookSignature(body, signature, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(signed))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return expected === signature;
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
      return jsonResponse({ status: 'ok' }, 200, origin);
    }

    // ──────────────────────────────────────────────
    // LemonSqueezy webhook: creates/tops up licenses
    // ──────────────────────────────────────────────
    if (url.pathname === '/webhooks/lemonsqueezy' && request.method === 'POST') {
      try {
        const rawBody = await request.text();
        const signature = request.headers.get('X-Signature');

        // Verify signature
        if (env.LEMONSQUEEZY_WEBHOOK_SECRET && signature) {
          const valid = await verifyWebhookSignature(rawBody, signature, env.LEMONSQUEEZY_WEBHOOK_SECRET);
          if (!valid) {
            return jsonResponse({ error: 'Invalid signature' }, 401, origin);
          }
        }

        const payload = JSON.parse(rawBody);
        const eventName = payload.meta?.event_name;

        if (eventName !== 'order_created') {
          return jsonResponse({ ok: true, skipped: true }, 200, origin);
        }

        const email = payload.data?.attributes?.user_email;
        const orderId = String(payload.data?.id || '');
        const variantId = String(payload.data?.attributes?.first_order_item?.variant_id || '');
        const product = payload.meta?.custom_data?.product || 'job-red-flag-detector';

        // Determine credits from variant
        let credits = CREDIT_BUNDLES[variantId];
        if (!credits) {
          // Fallback: check custom_data for credits amount
          credits = parseInt(payload.meta?.custom_data?.credits) || 20;
        }

        // Idempotency: check if this order was already processed
        const existingTransaction = await env.DB.prepare(
          'SELECT id FROM credit_transactions WHERE order_id = ?'
        ).bind(orderId).first();

        if (existingTransaction) {
          return jsonResponse({ ok: true, already_processed: true }, 200, origin);
        }

        // Check if license already exists for this email+product
        const existingLicense = await env.DB.prepare(
          'SELECT license_key, credits_remaining FROM licenses WHERE email = ? AND product = ?'
        ).bind(email, product).first();

        let licenseKey;

        if (existingLicense) {
          // Top up existing license
          licenseKey = existingLicense.license_key;
          await env.DB.prepare(
            'UPDATE licenses SET credits_remaining = credits_remaining + ?, updated_at = datetime(\'now\') WHERE license_key = ?'
          ).bind(credits, licenseKey).run();
        } else {
          // Create new license
          licenseKey = crypto.randomUUID();
          await env.DB.prepare(
            'INSERT INTO licenses (license_key, product, email, credits_remaining) VALUES (?, ?, ?, ?)'
          ).bind(licenseKey, product, email, credits).run();
        }

        // Record transaction
        await env.DB.prepare(
          'INSERT INTO credit_transactions (license_key, change, reason, order_id) VALUES (?, ?, ?, ?)'
        ).bind(licenseKey, credits, `purchase:${credits}`, orderId).run();

        return jsonResponse({ ok: true, license_key: licenseKey }, 200, origin);
      } catch (err) {
        console.error('Webhook error:', err);
        return jsonResponse({ error: 'Webhook processing failed' }, 500, origin);
      }
    }

    // ──────────────────────────────────────────────
    // Credits check: returns remaining credits for a license key
    // ──────────────────────────────────────────────
    if (url.pathname === '/api/credits' && request.method === 'GET') {
      const licenseKey = url.searchParams.get('license_key');

      if (!licenseKey) {
        return jsonResponse({ error: 'Missing license_key parameter' }, 400, origin);
      }

      const license = await env.DB.prepare(
        'SELECT credits_remaining, product FROM licenses WHERE license_key = ?'
      ).bind(licenseKey).first();

      if (!license) {
        return jsonResponse({ error: 'invalid_key', message: 'Invalid license key.' }, 401, origin);
      }

      return jsonResponse({
        credits_remaining: license.credits_remaining,
        product: license.product,
      }, 200, origin);
    }

    // ──────────────────────────────────────────────
    // License lookup: find license key by email + product
    // ──────────────────────────────────────────────
    if (url.pathname === '/api/license-lookup' && request.method === 'GET') {
      const email = url.searchParams.get('email');
      const product = url.searchParams.get('product');

      if (!email || !product) {
        return jsonResponse({ error: 'Missing email or product parameter' }, 400, origin);
      }

      const license = await env.DB.prepare(
        'SELECT license_key, credits_remaining FROM licenses WHERE email = ? AND product = ?'
      ).bind(email, product).first();

      if (!license) {
        return jsonResponse({ error: 'No license found for this email and product.' }, 404, origin);
      }

      return jsonResponse({
        license_key: license.license_key,
        credits_remaining: license.credits_remaining,
      }, 200, origin);
    }

    // ──────────────────────────────────────────────
    // Scan endpoint: validates license, deducts credit, calls Claude
    // ──────────────────────────────────────────────
    if (url.pathname === '/api/scan' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { type, text, license_key } = body;

        // Validate license key
        if (!license_key) {
          return jsonResponse({ error: 'license_required', message: 'A license key is required to use this tool.' }, 401, origin);
        }

        // Validate request fields
        if (!type || !text) {
          return jsonResponse({ error: 'Missing required fields: type, text' }, 400, origin);
        }

        const prompt = PROMPTS[type];
        if (!prompt) {
          return jsonResponse({ error: `Unknown scan type: ${type}` }, 400, origin);
        }

        // Check license validity and product match
        const expectedProduct = PRODUCT_FOR_TYPE[type];
        const license = await env.DB.prepare(
          'SELECT credits_remaining, product FROM licenses WHERE license_key = ?'
        ).bind(license_key).first();

        if (!license) {
          return jsonResponse({ error: 'invalid_key', message: 'Invalid license key.' }, 401, origin);
        }

        if (license.product !== expectedProduct) {
          return jsonResponse({ error: 'invalid_key', message: 'This license key is not valid for this product.' }, 401, origin);
        }

        if (license.credits_remaining <= 0) {
          return jsonResponse({ error: 'no_credits', message: 'No scans remaining. Purchase more credits.', credits_remaining: 0 }, 403, origin);
        }

        // Deduct credit atomically (prevents race conditions)
        const deductResult = await env.DB.prepare(
          'UPDATE licenses SET credits_remaining = credits_remaining - 1, updated_at = datetime(\'now\') WHERE license_key = ? AND credits_remaining > 0'
        ).bind(license_key).run();

        if (deductResult.meta.changes === 0) {
          return jsonResponse({ error: 'no_credits', message: 'No scans remaining.', credits_remaining: 0 }, 403, origin);
        }

        // Record scan transaction
        await env.DB.prepare(
          'INSERT INTO credit_transactions (license_key, change, reason) VALUES (?, -1, ?)'
        ).bind(license_key, `scan:${type}`).run();

        // Limit text length to control costs
        const maxLength = 15000;
        const trimmedText = text.length > maxLength ? text.substring(0, maxLength) + '\n\n[Text truncated]' : text;

        // Call Claude API
        let claudeResponse;
        try {
          claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
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
        } catch (fetchErr) {
          // Claude API unreachable — refund the credit
          await env.DB.prepare(
            'UPDATE licenses SET credits_remaining = credits_remaining + 1 WHERE license_key = ?'
          ).bind(license_key).run();
          await env.DB.prepare(
            'INSERT INTO credit_transactions (license_key, change, reason) VALUES (?, 1, ?)'
          ).bind(license_key, 'refund:api_error').run();
          console.error('Claude API fetch error:', fetchErr);
          return jsonResponse({ error: 'Analysis service temporarily unavailable' }, 502, origin);
        }

        if (!claudeResponse.ok) {
          // Claude API error — refund the credit
          await env.DB.prepare(
            'UPDATE licenses SET credits_remaining = credits_remaining + 1 WHERE license_key = ?'
          ).bind(license_key).run();
          await env.DB.prepare(
            'INSERT INTO credit_transactions (license_key, change, reason) VALUES (?, 1, ?)'
          ).bind(license_key, 'refund:api_error').run();
          const errorText = await claudeResponse.text();
          console.error('Anthropic API error:', errorText);
          return jsonResponse({ error: 'Analysis service temporarily unavailable' }, 502, origin);
        }

        const result = await claudeResponse.json();
        const content = result.content[0].text;

        // Parse the JSON response from Claude
        let parsed;
        try {
          const cleaned = content.replace(/^```(?:json)?\n?/g, '').replace(/\n?```$/g, '').trim();
          parsed = JSON.parse(cleaned);
        } catch {
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

        // Get updated credit count
        const updatedLicense = await env.DB.prepare(
          'SELECT credits_remaining FROM licenses WHERE license_key = ?'
        ).bind(license_key).first();

        parsed.credits_remaining = updatedLicense?.credits_remaining ?? 0;

        return jsonResponse(parsed, 200, origin);
      } catch (err) {
        console.error('Request error:', err);
        return jsonResponse({ error: 'Internal server error' }, 500, origin);
      }
    }

    // 404 for everything else
    return jsonResponse({ error: 'Not found' }, 404, origin);
  },
};
