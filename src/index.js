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

// ──────────────────────────────────────────────
// Refund handler: deducts credits, suspends if empty
// ──────────────────────────────────────────────
async function handleRefund(event, env, origin) {
  const charge = event.data.object;
  const chargeId = charge.id;
  const paymentIntentId = charge.payment_intent;
  const refundAmount = charge.amount_refunded / 100;
  const testMode = event.livemode === false;

  // Idempotency: check if this refund was already processed
  const existing = await env.DB.prepare(
    'SELECT id FROM credit_transactions WHERE order_id = ?'
  ).bind(chargeId).first();
  if (existing) {
    return jsonResponse({ ok: true, already_processed: true }, 200, origin);
  }

  // Find the original purchase by looking up the checkout session via Stripe API
  const stripeKey = testMode ? (env.STRIPE_SECRET_KEY_TEST || env.STRIPE_SECRET_KEY) : env.STRIPE_SECRET_KEY;
  const sessionsResponse = await fetch(
    `https://api.stripe.com/v1/checkout/sessions?payment_intent=${paymentIntentId}&limit=1`,
    { headers: { 'Authorization': `Bearer ${stripeKey}` } }
  );
  if (!sessionsResponse.ok) {
    console.error(`[REFUND_ERROR] Failed to look up session for payment_intent=${paymentIntentId}`);
    return jsonResponse({ error: 'Failed to look up original session' }, 500, origin);
  }
  const sessions = await sessionsResponse.json();
  const sessionId = sessions.data?.[0]?.id;
  if (!sessionId) {
    console.error(`[REFUND_ERROR] No session found for payment_intent=${paymentIntentId}`);
    return jsonResponse({ error: 'Original session not found' }, 500, origin);
  }

  // Find the license from the original purchase transaction
  const purchaseTransaction = await env.DB.prepare(
    'SELECT license_key, change FROM credit_transactions WHERE order_id = ? AND reason LIKE \'purchase:%\''
  ).bind(sessionId).first();
  if (!purchaseTransaction) {
    console.error(`[REFUND_ERROR] No purchase transaction found for session=${sessionId}`);
    return jsonResponse({ error: 'Original purchase not found' }, 500, origin);
  }

  const licenseKey = purchaseTransaction.license_key;
  const originalCredits = purchaseTransaction.change;

  // Deduct the originally purchased credits (not what remains)
  const license = await env.DB.prepare(
    'SELECT credits_remaining, product FROM licenses WHERE license_key = ?'
  ).bind(licenseKey).first();
  if (!license) {
    console.error(`[REFUND_ERROR] License not found for key=${licenseKey}`);
    return jsonResponse({ error: 'License not found' }, 500, origin);
  }

  const creditsToDeduct = Math.min(originalCredits, license.credits_remaining);
  const newCredits = license.credits_remaining - creditsToDeduct;
  const newStatus = newCredits <= 0 ? 'suspended' : 'active';

  await env.DB.prepare(
    'UPDATE licenses SET credits_remaining = ?, status = ?, updated_at = datetime(\'now\') WHERE license_key = ?'
  ).bind(newCredits, newStatus, licenseKey).run();

  await env.DB.prepare(
    'INSERT INTO credit_transactions (license_key, change, reason, order_id) VALUES (?, ?, ?, ?)'
  ).bind(licenseKey, -creditsToDeduct, `refund:${chargeId}`, chargeId).run();

  // Log refund as negative sale in Google Sheets
  const productName = PRODUCT_DISPLAY_NAMES[license.product] || license.product;
  try {
    await fetch(env.GOOGLE_SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: new Date().toISOString().substring(0, 10),
        order_id: chargeId,
        product: productName,
        variant: 'Refund',
        amount: -refundAmount,
        email: '',
        test_mode: testMode ? 'Yes' : 'No',
        country: '',
      }),
      redirect: 'follow',
    });
  } catch (e) {
    console.error(`[SHEETS_ERROR] Failed to log refund | charge=${chargeId}`, e.message || e);
  }

  console.log(`[REFUND] Processed refund for charge=${chargeId} license=${licenseKey} credits_deducted=${creditsToDeduct} new_status=${newStatus}`);
  return jsonResponse({ ok: true, license_key: licenseKey, credits_deducted: creditsToDeduct, status: newStatus }, 200, origin);
}

// ──────────────────────────────────────────────
// Dispute created handler: immediately revokes license
// ──────────────────────────────────────────────
async function handleDisputeCreated(event, env, origin) {
  const dispute = event.data.object;
  const disputeId = dispute.id;
  const chargeId = dispute.charge;
  const disputeAmount = dispute.amount / 100;
  const testMode = event.livemode === false;

  // Idempotency
  const existing = await env.DB.prepare(
    'SELECT id FROM credit_transactions WHERE order_id = ?'
  ).bind(disputeId).first();
  if (existing) {
    return jsonResponse({ ok: true, already_processed: true }, 200, origin);
  }

  // Look up the charge to get payment_intent, then find the session
  const stripeKey = testMode ? (env.STRIPE_SECRET_KEY_TEST || env.STRIPE_SECRET_KEY) : env.STRIPE_SECRET_KEY;
  const chargeResponse = await fetch(
    `https://api.stripe.com/v1/charges/${chargeId}`,
    { headers: { 'Authorization': `Bearer ${stripeKey}` } }
  );
  if (!chargeResponse.ok) {
    console.error(`[CHARGEBACK_ERROR] Failed to look up charge=${chargeId}`);
    return jsonResponse({ error: 'Failed to look up charge' }, 500, origin);
  }
  const charge = await chargeResponse.json();
  const paymentIntentId = charge.payment_intent;

  const sessionsResponse = await fetch(
    `https://api.stripe.com/v1/checkout/sessions?payment_intent=${paymentIntentId}&limit=1`,
    { headers: { 'Authorization': `Bearer ${stripeKey}` } }
  );
  if (!sessionsResponse.ok) {
    console.error(`[CHARGEBACK_ERROR] Failed to look up session for payment_intent=${paymentIntentId}`);
    return jsonResponse({ error: 'Failed to look up original session' }, 500, origin);
  }
  const sessions = await sessionsResponse.json();
  const sessionId = sessions.data?.[0]?.id;
  if (!sessionId) {
    console.error(`[CHARGEBACK_ERROR] No session found for payment_intent=${paymentIntentId}`);
    return jsonResponse({ error: 'Original session not found' }, 500, origin);
  }

  const purchaseTransaction = await env.DB.prepare(
    'SELECT license_key FROM credit_transactions WHERE order_id = ? AND reason LIKE \'purchase:%\''
  ).bind(sessionId).first();
  if (!purchaseTransaction) {
    console.error(`[CHARGEBACK_ERROR] No purchase transaction found for session=${sessionId}`);
    return jsonResponse({ error: 'Original purchase not found' }, 500, origin);
  }

  const licenseKey = purchaseTransaction.license_key;
  const license = await env.DB.prepare(
    'SELECT credits_remaining, product FROM licenses WHERE license_key = ?'
  ).bind(licenseKey).first();
  if (!license) {
    console.error(`[CHARGEBACK_ERROR] License not found for key=${licenseKey}`);
    return jsonResponse({ error: 'License not found' }, 500, origin);
  }

  const creditsRevoked = license.credits_remaining;

  // Revoke immediately — zero out credits, set status to revoked
  await env.DB.prepare(
    'UPDATE licenses SET credits_remaining = 0, status = \'revoked\', updated_at = datetime(\'now\') WHERE license_key = ?'
  ).bind(licenseKey).run();

  await env.DB.prepare(
    'INSERT INTO credit_transactions (license_key, change, reason, order_id) VALUES (?, ?, ?, ?)'
  ).bind(licenseKey, -creditsRevoked, `chargeback:${disputeId}`, disputeId).run();

  // Log chargeback as negative sale
  const productName = PRODUCT_DISPLAY_NAMES[license.product] || license.product;
  try {
    await fetch(env.GOOGLE_SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: new Date().toISOString().substring(0, 10),
        order_id: disputeId,
        product: productName,
        variant: 'Chargeback',
        amount: -disputeAmount,
        email: '',
        test_mode: testMode ? 'Yes' : 'No',
        country: '',
      }),
      redirect: 'follow',
    });
  } catch (e) {
    console.error(`[SHEETS_ERROR] Failed to log chargeback | dispute=${disputeId}`, e.message || e);
  }

  // Log Stripe dispute fee (EUR 15) as expense
  try {
    const feeParams = new URLSearchParams({
      action: 'addExpense',
      date: new Date().toISOString().substring(0, 10),
      supplier: 'Stripe',
      description: `Chargeback dispute fee (${disputeId})`,
      category: 'Fees',
      amount: '15',
      key: env.GOOGLE_SHEETS_API_KEY,
    });
    await fetch(`${env.GOOGLE_SHEETS_URL}?${feeParams}`, { redirect: 'follow' });
  } catch (e) {
    console.error(`[SHEETS_ERROR] Failed to log dispute fee | dispute=${disputeId}`, e.message || e);
  }

  console.error(`[CHARGEBACK] License revoked | dispute=${disputeId} charge=${chargeId} license=${licenseKey} credits_revoked=${creditsRevoked}`);
  return jsonResponse({ ok: true, license_key: licenseKey, credits_revoked: creditsRevoked, status: 'revoked' }, 200, origin);
}

// ──────────────────────────────────────────────
// Dispute closed handler: reinstate if won
// ──────────────────────────────────────────────
async function handleDisputeClosed(event, env, origin) {
  const dispute = event.data.object;
  const disputeId = dispute.id;
  const disputeStatus = dispute.status; // 'won' or 'lost'

  if (disputeStatus !== 'won') {
    console.log(`[CHARGEBACK] Dispute lost | dispute=${disputeId}`);
    return jsonResponse({ ok: true, dispute_status: disputeStatus }, 200, origin);
  }

  // Dispute won — reinstate the license
  const chargebackTransaction = await env.DB.prepare(
    'SELECT license_key, change FROM credit_transactions WHERE order_id = ? AND reason LIKE \'chargeback:%\''
  ).bind(disputeId).first();
  if (!chargebackTransaction) {
    console.error(`[CHARGEBACK_ERROR] No chargeback transaction found for dispute=${disputeId}`);
    return jsonResponse({ error: 'Chargeback transaction not found' }, 500, origin);
  }

  const licenseKey = chargebackTransaction.license_key;
  const creditsToRestore = Math.abs(chargebackTransaction.change);

  // Idempotency: check if reversal already processed
  const existingReversal = await env.DB.prepare(
    'SELECT id FROM credit_transactions WHERE order_id = ? AND reason LIKE \'chargeback_reversed:%\''
  ).bind(disputeId).first();
  if (existingReversal) {
    return jsonResponse({ ok: true, already_processed: true }, 200, origin);
  }

  await env.DB.prepare(
    'UPDATE licenses SET credits_remaining = credits_remaining + ?, status = \'active\', updated_at = datetime(\'now\') WHERE license_key = ?'
  ).bind(creditsToRestore, licenseKey).run();

  await env.DB.prepare(
    'INSERT INTO credit_transactions (license_key, change, reason, order_id) VALUES (?, ?, ?, ?)'
  ).bind(licenseKey, creditsToRestore, `chargeback_reversed:${disputeId}`, disputeId).run();

  console.log(`[CHARGEBACK] Dispute won, license reinstated | dispute=${disputeId} license=${licenseKey} credits_restored=${creditsToRestore}`);
  return jsonResponse({ ok: true, license_key: licenseKey, credits_restored: creditsToRestore, status: 'active' }, 200, origin);
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

        // Verify Stripe signature — try live secret first, then test secret
        if (!sigHeader) {
          return jsonResponse({ error: 'Missing signature' }, 401, origin);
        }
        const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_WEBHOOK_SECRET_TEST].filter(Boolean);
        if (secrets.length === 0) {
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
        let signatureValid = false;
        for (const secret of secrets) {
          const key = await crypto.subtle.importKey(
            'raw', encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
          );
          const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
          const expected = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2, '0')).join('');
          if (expected === sig) {
            signatureValid = true;
            break;
          }
        }
        if (!signatureValid) {
          return jsonResponse({ error: 'Invalid signature' }, 401, origin);
        }

        const event = JSON.parse(rawBody);

        // ── Handle refunds ──
        if (event.type === 'charge.refunded') {
          return await handleRefund(event, env, origin);
        }

        // ── Handle chargebacks ──
        if (event.type === 'charge.dispute.created') {
          return await handleDisputeCreated(event, env, origin);
        }

        if (event.type === 'charge.dispute.closed') {
          return await handleDisputeClosed(event, env, origin);
        }

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
        const stripeKey = testMode ? (env.STRIPE_SECRET_KEY_TEST || env.STRIPE_SECRET_KEY) : env.STRIPE_SECRET_KEY;
        const lineItemsResponse = await fetch(
          `https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items`,
          { headers: { 'Authorization': `Bearer ${stripeKey}` } }
        );
        if (!lineItemsResponse.ok) {
          console.error(`[WEBHOOK_ERROR] Stripe line_items API error ${lineItemsResponse.status} | session=${sessionId}`);
          return jsonResponse({ error: 'Failed to fetch line items' }, 500, origin);
        }
        const lineItems = await lineItemsResponse.json();
        const priceId = lineItems.data?.[0]?.price?.id;
        const priceInfo = STRIPE_PRICES[priceId];

        if (!priceInfo) {
          console.error(`[WEBHOOK_ERROR] Unknown Stripe price ID ${priceId} | session=${sessionId}`);
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
          'SELECT license_key, credits_remaining, status FROM licenses WHERE email = ? AND product = ?'
        ).bind(email, product).first();

        let licenseKey;

        if (existingLicense) {
          licenseKey = existingLicense.license_key;
          // Reactivate suspended licenses on new purchase (but not revoked — chargebacks stay revoked)
          const newStatus = existingLicense.status === 'suspended' ? 'active' : existingLicense.status;
          await env.DB.prepare(
            'UPDATE licenses SET credits_remaining = credits_remaining + ?, status = ?, updated_at = datetime(\'now\') WHERE license_key = ?'
          ).bind(credits, newStatus, licenseKey).run();
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
        } catch (e) {
          console.error(`[SHEETS_ERROR] Failed to log sale | order=${sessionId} email=${email}`, e.message || e);
        }

        // Log Stripe fee as expense
        const saleAmount = amountTotal / 100;
        const stripeFee = Math.round((saleAmount * 0.015 + 0.25) * 100) / 100;
        try {
          const feeParams = new URLSearchParams({
            action: 'addExpense',
            date: sheetData.date,
            supplier: 'Stripe',
            description: `Payment processing fee (${sessionId})`,
            category: 'Fees',
            amount: String(stripeFee),
            key: env.GOOGLE_SHEETS_API_KEY,
          });
          await fetch(`${env.GOOGLE_SHEETS_URL}?${feeParams}`, { redirect: 'follow' });
        } catch (e) {
          console.error(`[SHEETS_ERROR] Failed to log Stripe fee | order=${sessionId}`, e.message || e);
        }

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
    <li>Install the extension: <a href="https://chromewebstore.google.com/detail/job-red-flag-detector/opcklnckbijmdlmdjgmhdnkclkehemni" style="color: #fb923c;">Chrome</a> or <a href="https://microsoftedge.microsoft.com/addons/detail/job-red-flag-detector/nnppdamkeahgdhcgjcfijjeapcijngpk" style="color: #fb923c;">Edge</a></li>
    <li>Open the extension and paste your license key</li>
    <li>Start scanning</li>
  </ol>
  <p style="color: #94a3b8; font-size: 14px; margin-top: 30px;">Need help? Reply to this email or contact <a href="mailto:andreas@zurhaartools.com" style="color: #fb923c;">andreas@zurhaartools.com</a></p>
  <p style="color: #94a3b8; font-size: 12px;">Zurhaar Tools — <a href="https://zurhaartools.com" style="color: #fb923c;">zurhaartools.com</a></p>
</div>`,
            }),
          });
        } catch (e) {
          console.error(`[EMAIL_ERROR] Failed to send license key email | order=${sessionId} email=${email}`, e.message || e);
        }

        return jsonResponse({ ok: true, license_key: licenseKey }, 200, origin);
      } catch (err) {
        console.error(`[WEBHOOK_ERROR] Stripe webhook processing failed`, err.message || err);
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
        'SELECT license_key, credits_remaining, product, status FROM licenses WHERE license_key = ?'
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
        'SELECT credits_remaining, product, status FROM licenses WHERE license_key = ?'
      ).bind(licenseKey).first();

      if (!license) {
        return jsonResponse({ error: 'invalid_key', message: 'Invalid license key.' }, 401, origin);
      }

      return jsonResponse({
        credits_remaining: license.credits_remaining,
        product: license.product,
        status: license.status,
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
          'SELECT credits_remaining, product, status FROM licenses WHERE license_key = ?'
        ).bind(license_key).first();

        if (!license) {
          return jsonResponse({ error: 'invalid_key', message: 'Invalid license key.' }, 401, origin);
        }

        if (license.status !== 'active') {
          return jsonResponse({ error: 'license_suspended', message: 'This license has been suspended.' }, 403, origin);
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
          console.error(`[SCAN_ERROR] Claude API unreachable | type=${type} key=${license_key}`, fetchErr.message || fetchErr);
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
          console.error(`[SCAN_ERROR] Claude API error ${claudeResponse.status} | type=${type} key=${license_key}`, errorText);
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
        console.error(`[SCAN_ERROR] Request processing failed`, err.message || err);
        return jsonResponse({ error: 'Internal server error' }, 500, origin);
      }
    }

    // ──────────────────────────────────────────────
    // License key recovery: resends license key(s) to email
    // ──────────────────────────────────────────────
    if (url.pathname === '/api/recover' && request.method === 'POST') {
      const genericResponse = { ok: true, message: 'If an account exists with this email, a recovery email has been sent.' };

      try {
        const body = await request.json();
        const { email } = body;

        if (!email) {
          return jsonResponse({ error: 'Missing email field' }, 400, origin);
        }

        // Find all active licenses for this email
        const licenses = await env.DB.prepare(
          'SELECT license_key, product, credits_remaining, last_recovery_at FROM licenses WHERE email = ? AND status = \'active\''
        ).bind(email).all();

        if (!licenses.results || licenses.results.length === 0) {
          return jsonResponse(genericResponse, 200, origin);
        }

        // Rate limit: check if any license had a recovery email in the last 5 minutes
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const recentRecovery = licenses.results.some(
          l => l.last_recovery_at && l.last_recovery_at > fiveMinutesAgo
        );
        if (recentRecovery) {
          console.log(`[RECOVERY] Rate limited | email=${email}`);
          return jsonResponse(genericResponse, 200, origin);
        }

        // Build license list HTML
        const licenseListHtml = licenses.results.map(l => {
          const displayName = PRODUCT_DISPLAY_NAMES[l.product] || l.product;
          return `<div style="background: #12121a; border: 1px solid #2e2e42; border-radius: 8px; padding: 16px; margin: 12px 0;">
    <p style="margin: 0 0 8px 0; color: #e2e8f0;"><strong>${displayName}</strong></p>
    <code style="color: #fb923c; font-size: 16px; word-break: break-all;">${l.license_key}</code>
    <p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 14px;">${l.credits_remaining} scans remaining</p>
  </div>`;
        }).join('');

        // Send recovery email
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
              subject: 'License Key Recovery — Zurhaar Tools',
              html: `<div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #f97316;">Your license keys</h2>
  <p>Here are the license keys associated with your email:</p>
  ${licenseListHtml}
  <h3>How to use</h3>
  <ol>
    <li>Install the extension: <a href="https://chromewebstore.google.com/detail/job-red-flag-detector/opcklnckbijmdlmdjgmhdnkclkehemni" style="color: #fb923c;">Chrome</a> or <a href="https://microsoftedge.microsoft.com/addons/detail/job-red-flag-detector/nnppdamkeahgdhcgjcfijjeapcijngpk" style="color: #fb923c;">Edge</a></li>
    <li>Open the extension and paste your license key</li>
    <li>Start scanning</li>
  </ol>
  <p style="color: #94a3b8; font-size: 14px; margin-top: 30px;">Need help? Reply to this email or contact <a href="mailto:andreas@zurhaartools.com" style="color: #fb923c;">andreas@zurhaartools.com</a></p>
  <p style="color: #94a3b8; font-size: 12px;">Zurhaar Tools — <a href="https://zurhaartools.com" style="color: #fb923c;">zurhaartools.com</a></p>
</div>`,
            }),
          });
        } catch (e) {
          console.error(`[RECOVERY_ERROR] Failed to send recovery email | email=${email}`, e.message || e);
          return jsonResponse(genericResponse, 200, origin);
        }

        // Update last_recovery_at for all licenses
        const now = new Date().toISOString();
        for (const l of licenses.results) {
          await env.DB.prepare(
            'UPDATE licenses SET last_recovery_at = ? WHERE license_key = ?'
          ).bind(now, l.license_key).run();
        }

        console.log(`[RECOVERY] Recovery email sent | email=${email} licenses=${licenses.results.length}`);
        return jsonResponse(genericResponse, 200, origin);
      } catch (err) {
        console.error(`[RECOVERY_ERROR] Recovery failed`, err.message || err);
        return jsonResponse(genericResponse, 200, origin);
      }
    }

    // ──────────────────────────────────────────────
    // Admin: GDPR customer data deletion (anonymization)
    // ──────────────────────────────────────────────
    if (url.pathname === '/api/admin/delete-customer' && request.method === 'POST') {
      // Authenticate with ADMIN_API_KEY
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!token || token !== env.ADMIN_API_KEY) {
        return jsonResponse({ error: 'Unauthorized' }, 401, origin);
      }

      try {
        const body = await request.json();
        const { email } = body;

        if (!email) {
          return jsonResponse({ error: 'Missing email field' }, 400, origin);
        }

        // Find all licenses for this email
        const licenses = await env.DB.prepare(
          'SELECT id, license_key FROM licenses WHERE email = ?'
        ).bind(email).all();

        if (!licenses.results || licenses.results.length === 0) {
          return jsonResponse({ error: 'No customer found with this email' }, 404, origin);
        }

        let transactionsAnonymized = 0;

        for (const license of licenses.results) {
          const anonymizedKey = `DELETED-${license.id}`;

          // Anonymize credit_transactions first (foreign key reference)
          const txResult = await env.DB.prepare(
            'UPDATE credit_transactions SET license_key = ? WHERE license_key = ?'
          ).bind(anonymizedKey, license.license_key).run();
          transactionsAnonymized += txResult.meta.changes;

          // Anonymize the license
          await env.DB.prepare(
            'UPDATE licenses SET email = ?, license_key = ?, credits_remaining = 0, status = \'deleted\', updated_at = datetime(\'now\') WHERE id = ?'
          ).bind('deleted@anonymized.invalid', anonymizedKey, license.id).run();
        }

        console.log(`[GDPR] Customer data anonymized | email=${email} licenses=${licenses.results.length} transactions=${transactionsAnonymized}`);
        return jsonResponse({
          ok: true,
          licenses_anonymized: licenses.results.length,
          transactions_anonymized: transactionsAnonymized,
        }, 200, origin);
      } catch (err) {
        console.error(`[GDPR_ERROR] Customer deletion failed`, err.message || err);
        return jsonResponse({ error: 'Deletion failed' }, 500, origin);
      }
    }

    // 404 for everything else
    return jsonResponse({ error: 'Not found' }, 404, origin);
  },
};
