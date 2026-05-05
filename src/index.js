// Maps scan types to product names in the licenses table
const PRODUCT_FOR_TYPE = {
  'job-red-flags': 'job-red-flag-detector',
  'tos-scan': 'tos-scanner',
};

// Human-readable product names for emails and logging
const PRODUCT_DISPLAY_NAMES = {
  'job-red-flag-detector': 'Job Red Flag Detector',
  'tos-scanner': 'ToS Scanner',
};

// Maps Stripe price IDs to credit amounts and product info
const STRIPE_PRICES = {
  // Test prices
  'price_1TQmUD2OmqjfvJPqWpjGA7PV': { credits: 50, product: 'job-red-flag-detector', variant: '50 Scans' },
  'price_1TQmUE2OmqjfvJPqNVYjk4JV': { credits: 150, product: 'job-red-flag-detector', variant: '150 Scans' },
  'price_1TQmUE2OmqjfvJPqUXdldl3e': { credits: 500, product: 'job-red-flag-detector', variant: '500 Scans' },
  // Live prices
  'price_1TQoOk2OmqjfvJPqDzWnbzWZ': { credits: 50, product: 'job-red-flag-detector', variant: '50 Scans' },
  'price_1TQoOk2OmqjfvJPq844bFp1N': { credits: 150, product: 'job-red-flag-detector', variant: '150 Scans' },
  'price_1TQoOk2OmqjfvJPqB8j6OW4J': { credits: 500, product: 'job-red-flag-detector', variant: '500 Scans' },
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

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === 'https://zurhaartools.com') return true;
  if (origin.startsWith('chrome-extension://')) return true;
  if (origin.startsWith('extension://')) return true;
  return false;
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
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
    // Stripe webhook: creates/tops up licenses
    // ──────────────────────────────────────────────
    if (url.pathname === '/webhooks/stripe' && request.method === 'POST') {
      try {
        const rawBody = await request.text();
        const sigHeader = request.headers.get('stripe-signature');

        // Verify Stripe signature — always required
        if (!env.STRIPE_WEBHOOK_SECRET || !sigHeader) {
          return jsonResponse({ error: 'Missing signature' }, 401, origin);
        }
        const parts = {};
        sigHeader.split(',').forEach(p => {
          const [k, v] = p.split('=');
          parts[k] = v;
        });
        const timestamp = parts.t;
        const sig = parts.v1;
        const signedPayload = `${timestamp}.${rawBody}`;
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw', encoder.encode(env.STRIPE_WEBHOOK_SECRET),
          { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
        const expected = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2, '0')).join('');
        if (expected !== sig) {
          return jsonResponse({ error: 'Invalid signature' }, 401, origin);
        }

        const event = JSON.parse(rawBody);

        if (event.type !== 'checkout.session.completed') {
          return jsonResponse({ ok: true, skipped: true }, 200, origin);
        }

        const session = event.data.object;
        const email = session.customer_details?.email;
        const sessionId = session.id;
        const amountTotal = session.amount_total || 0;
        const currency = session.currency || 'eur';
        const country = session.customer_details?.address?.country || '';
        const testMode = event.livemode === false;

        // Get line items to determine which price was purchased
        const lineItemsResponse = await fetch(
          `https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items`,
          { headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` } }
        );
        if (!lineItemsResponse.ok) {
          console.error('Stripe line_items API error:', lineItemsResponse.status);
          return jsonResponse({ error: 'Failed to fetch line items' }, 500, origin);
        }
        const lineItems = await lineItemsResponse.json();
        const priceId = lineItems.data?.[0]?.price?.id;
        const priceInfo = STRIPE_PRICES[priceId];

        if (!priceInfo) {
          console.error('Unknown Stripe price ID:', priceId);
          return jsonResponse({ error: 'Unknown price' }, 500, origin);
        }

        const { credits, product, variant } = priceInfo;

        // Idempotency: check if this session was already processed
        const existingTransaction = await env.DB.prepare(
          'SELECT id FROM credit_transactions WHERE order_id = ?'
        ).bind(sessionId).first();

        if (existingTransaction) {
          return jsonResponse({ ok: true, already_processed: true }, 200, origin);
        }

        // Check if license already exists for this email+product
        const existingLicense = await env.DB.prepare(
          'SELECT license_key, credits_remaining FROM licenses WHERE email = ? AND product = ?'
        ).bind(email, product).first();

        let licenseKey;

        if (existingLicense) {
          licenseKey = existingLicense.license_key;
          await env.DB.prepare(
            'UPDATE licenses SET credits_remaining = credits_remaining + ?, updated_at = datetime(\'now\') WHERE license_key = ?'
          ).bind(credits, licenseKey).run();
        } else {
          licenseKey = crypto.randomUUID().toUpperCase();
          await env.DB.prepare(
            'INSERT INTO licenses (license_key, product, email, credits_remaining) VALUES (?, ?, ?, ?)'
          ).bind(licenseKey, product, email, credits).run();
        }

        // Record transaction
        await env.DB.prepare(
          'INSERT INTO credit_transactions (license_key, change, reason, order_id) VALUES (?, ?, ?, ?)'
        ).bind(licenseKey, credits, `purchase:${credits}`, sessionId).run();

        // Log sale to Google Sheets
        const productName = PRODUCT_DISPLAY_NAMES[product] || product;
        const sheetData = {
          date: new Date().toISOString().substring(0, 10),
          order_id: sessionId,
          product: productName,
          variant: variant,
          amount: amountTotal / 100,
          email: email,
          test_mode: testMode ? 'Yes' : 'No',
          country: country,
        };
        try {
          await fetch(env.GOOGLE_SHEETS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sheetData),
            redirect: 'follow',
          });
        } catch (e) { /* don't block on logging failure */ }

        // Send license key email via Resend
        const totalCredits = existingLicense
          ? existingLicense.credits_remaining + credits
          : credits;
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Zurhaar Tools <andreas@zurhaartools.com>',
              to: email,
              subject: `Your license key — ${productName} ${variant}`,
              html: `<div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #f97316;">Thanks for your purchase!</h2>
  <p>Here is your license key for the <strong>${productName}</strong>:</p>
  <div style="background: #12121a; border: 1px solid #2e2e42; border-radius: 8px; padding: 16px; margin: 20px 0;">
    <code style="color: #fb923c; font-size: 16px; word-break: break-all;">${licenseKey}</code>
  </div>
  <p><strong>Credits:</strong> ${totalCredits} scans available</p>
  <h3>How to use</h3>
  <ol>
    <li>Install the ${productName} browser extension</li>
    <li>Open the extension and paste your license key</li>
    <li>Start scanning</li>
  </ol>
  <p style="color: #94a3b8; font-size: 14px; margin-top: 30px;">Need help? Reply to this email or contact <a href="mailto:andreas@zurhaartools.com" style="color: #fb923c;">andreas@zurhaartools.com</a></p>
  <p style="color: #94a3b8; font-size: 12px;">Zurhaar Tools — <a href="https://zurhaartools.com" style="color: #fb923c;">zurhaartools.com</a></p>
</div>`,
            }),
          });
        } catch (e) { /* don't block on email failure */ }

        return jsonResponse({ ok: true, license_key: licenseKey }, 200, origin);
      } catch (err) {
        console.error('Stripe webhook error:', err);
        return jsonResponse({ error: 'Webhook processing failed' }, 500, origin);
      }
    }

    // ──────────────────────────────────────────────
    // License key lookup by session ID (for success page)
    // ──────────────────────────────────────────────
    if (url.pathname === '/api/license' && request.method === 'GET') {
      const sessionId = url.searchParams.get('session_id');
      if (!sessionId) {
        return jsonResponse({ error: 'Missing session_id' }, 400, origin);
      }
      const transaction = await env.DB.prepare(
        'SELECT license_key FROM credit_transactions WHERE order_id = ?'
      ).bind(sessionId).first();
      if (!transaction) {
        return jsonResponse({ error: 'not_found' }, 404, origin);
      }
      const license = await env.DB.prepare(
        'SELECT license_key, credits_remaining, product FROM licenses WHERE license_key = ?'
      ).bind(transaction.license_key).first();
      return jsonResponse(license || { error: 'not_found' }, license ? 200 : 404, origin);
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
