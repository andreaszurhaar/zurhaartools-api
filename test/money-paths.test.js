// Money-path tests: every flow that creates, spends, refunds, or revokes
// credits — plus the auth gates in front of them. Runs in workerd via
// @cloudflare/vitest-pool-workers; D1 is real (miniflare), outbound HTTP is
// mocked with MSW. D1 state is shared across tests in this file, so every
// test uses its own emails/keys/session ids.
//
// Best-effort side calls (Google Sheets, Resend) always answer 500 here:
// the worker's try/catch must swallow that and keep going — which doubles as
// a regression test for their best-effort contract.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import schemaSql from '../schema.sql?raw';

const PRICE_50 = 'price_1TQoOk2OmqjfvJPqDzWnbzWZ'; // live JRF 50-scan price
const WEBHOOK_SECRET = 'whsec_test_secret';

const server = setupServer(
  http.all('https://api.resend.com/*', () => new HttpResponse(null, { status: 500 })),
  http.all('https://sheets.invalid/*', () => new HttpResponse(null, { status: 500 }))
);

beforeAll(async () => {
  for (const stmt of schemaSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.DB.prepare(stmt).run();
  }
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function stripeSignature(body, secret = WEBHOOK_SECRET) {
  const t = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

async function postStripeEvent(event, { secret } = {}) {
  const body = JSON.stringify(event);
  return SELF.fetch('https://api.test/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': await stripeSignature(body, secret ?? WEBHOOK_SECRET) },
    body,
  });
}

function checkoutEvent(sessionId, { email = 'buyer@example.com' } = {}) {
  return {
    type: 'checkout.session.completed',
    livemode: true,
    data: {
      object: {
        id: sessionId,
        amount_total: 199,
        currency: 'eur',
        customer_details: { email, address: { country: 'NL' } },
        custom_fields: [],
      },
    },
  };
}

function mockLineItems(sessionId, priceId = PRICE_50) {
  server.use(
    http.get(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items`, () =>
      HttpResponse.json({ data: [{ price: { id: priceId } }] })
    )
  );
}

function mockSessionLookup(paymentIntent, sessionId) {
  server.use(
    http.get('https://api.stripe.com/v1/checkout/sessions', ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('payment_intent') !== paymentIntent) return undefined;
      return HttpResponse.json({ data: [{ id: sessionId }] });
    })
  );
}

async function license(licenseKey) {
  return env.DB.prepare('SELECT * FROM licenses WHERE license_key = ?').bind(licenseKey).first();
}

async function ledger(licenseKey) {
  const { results } = await env.DB.prepare(
    'SELECT change, reason, order_id FROM credit_transactions WHERE license_key = ? ORDER BY id'
  ).bind(licenseKey).all();
  return results;
}

async function seedLicense({ key = `TEST-KEY-${crypto.randomUUID()}`, product = 'job-red-flag-detector', email = 'buyer@example.com', credits = 10, status = 'active' } = {}) {
  await env.DB.prepare(
    'INSERT INTO licenses (license_key, product, email, credits_remaining, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(key, product, email, credits, status).run();
  return key;
}

describe('Stripe webhook auth', () => {
  it('rejects a bad signature', async () => {
    const body = JSON.stringify(checkoutEvent('cs_bad_sig'));
    const res = await SELF.fetch('https://api.test/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('rejects a missing signature', async () => {
    const res = await SELF.fetch('https://api.test/webhooks/stripe', {
      method: 'POST',
      body: JSON.stringify(checkoutEvent('cs_no_sig')),
    });
    expect(res.status).toBe(401);
  });
});

describe('checkout.session.completed', () => {
  it('creates a license with the purchased credits and one ledger row', async () => {
    mockLineItems('cs_new_1');
    const res = await postStripeEvent(checkoutEvent('cs_new_1', { email: 'new1@example.com' }));
    expect(res.status).toBe(200);
    const { license_key } = await res.json();

    const lic = await license(license_key);
    expect(lic.credits_remaining).toBe(50);
    expect(lic.status).toBe('active');
    expect(lic.email).toBe('new1@example.com');

    const tx = await ledger(license_key);
    expect(tx).toEqual([{ change: 50, reason: 'purchase:50', order_id: 'cs_new_1' }]);
  });

  it('is idempotent — a replayed event does not double-credit', async () => {
    mockLineItems('cs_replay_1');
    const first = await postStripeEvent(checkoutEvent('cs_replay_1', { email: 'replay1@example.com' }));
    const { license_key } = await first.json();

    // Stripe retries deliver the identical event again. Idempotency
    // short-circuits before the Stripe API call, so the line_items mock
    // being consumed or not is irrelevant here.
    const replay = await postStripeEvent(checkoutEvent('cs_replay_1', { email: 'replay1@example.com' }));
    expect(replay.status).toBe(200);
    expect((await replay.json()).already_processed).toBe(true);

    expect((await license(license_key)).credits_remaining).toBe(50);
    expect(await ledger(license_key)).toHaveLength(1);
  });

  it('tops up an existing license and reactivates a suspended one', async () => {
    const key = await seedLicense({ credits: 0, status: 'suspended', email: 'topup1@example.com' });
    mockLineItems('cs_topup_1');
    const res = await postStripeEvent(checkoutEvent('cs_topup_1', { email: 'topup1@example.com' }));
    expect(res.status).toBe(200);
    expect((await res.json()).license_key).toBe(key);

    const lic = await license(key);
    expect(lic.credits_remaining).toBe(50);
    expect(lic.status).toBe('active');
  });
});

describe('charge.refunded', () => {
  function refundEvent(chargeId, paymentIntent) {
    return {
      type: 'charge.refunded',
      livemode: true,
      data: { object: { id: chargeId, payment_intent: paymentIntent, amount_refunded: 199 } },
    };
  }

  it('deducts the purchased credits, suspends at zero, and replays idempotently', async () => {
    // Buy 50 credits.
    mockLineItems('cs_refund_1');
    const buy = await postStripeEvent(checkoutEvent('cs_refund_1', { email: 'refund1@example.com' }));
    const { license_key } = await buy.json();

    // Refund → worker resolves the session via the Stripe API.
    mockSessionLookup('pi_refund_1', 'cs_refund_1');
    const res = await postStripeEvent(refundEvent('ch_refund_1', 'pi_refund_1'));
    expect(res.status).toBe(200);

    const lic = await license(license_key);
    expect(lic.credits_remaining).toBe(0);
    expect(lic.status).toBe('suspended');

    // Replay is a no-op (idempotency keys on the refund ledger row).
    const replay = await postStripeEvent(refundEvent('ch_refund_1', 'pi_refund_1'));
    expect((await replay.json()).already_processed).toBe(true);
    expect((await license(license_key)).credits_remaining).toBe(0);
    expect(await ledger(license_key)).toHaveLength(2); // purchase + one refund
  });
});

describe('chargebacks', () => {
  it('revokes on dispute, reinstates on dispute won, both idempotent', async () => {
    mockLineItems('cs_dispute_1');
    const buy = await postStripeEvent(checkoutEvent('cs_dispute_1', { email: 'dispute1@example.com' }));
    const { license_key } = await buy.json();

    server.use(
      http.get('https://api.stripe.com/v1/charges/ch_dispute_1', () =>
        HttpResponse.json({ payment_intent: 'pi_dispute_1' })
      )
    );
    mockSessionLookup('pi_dispute_1', 'cs_dispute_1');

    const created = await postStripeEvent({
      type: 'charge.dispute.created',
      livemode: true,
      data: { object: { id: 'dp_1', charge: 'ch_dispute_1', amount: 199 } },
    });
    expect(created.status).toBe(200);
    let lic = await license(license_key);
    expect(lic.status).toBe('revoked');
    expect(lic.credits_remaining).toBe(0);

    const disputeWon = {
      type: 'charge.dispute.closed',
      livemode: true,
      data: { object: { id: 'dp_1', status: 'won' } },
    };
    const won = await postStripeEvent(disputeWon);
    expect(won.status).toBe(200);
    lic = await license(license_key);
    expect(lic.status).toBe('active');
    expect(lic.credits_remaining).toBe(50);

    // Replaying the win must not double-restore.
    await postStripeEvent(disputeWon);
    expect((await license(license_key)).credits_remaining).toBe(50);
  });
});

describe('/api/scan', () => {
  const scanRequest = (license_key) =>
    SELF.fetch('https://api.test/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'job-red-flags', text: 'Some job posting text', license_key }),
    });

  const mockClaude = (status, body) =>
    server.use(
      http.post('https://api.anthropic.com/v1/messages', () =>
        status === 200 ? HttpResponse.json(body) : new HttpResponse('overloaded', { status })
      )
    );

  it('deducts one credit on a successful scan', async () => {
    const key = await seedLicense({ credits: 10 });
    mockClaude(200, { content: [{ text: '{"score": 7, "summary": "ok", "redFlags": [], "greenFlags": []}' }] });

    const res = await scanRequest(key);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.score).toBe(7);
    expect(body.credits_remaining).toBe(9);
    expect((await license(key)).credits_remaining).toBe(9);
    expect(await ledger(key)).toEqual([{ change: -1, reason: 'scan:job-red-flags', order_id: null }]);
  });

  it('refunds the credit when Claude errors', async () => {
    const key = await seedLicense({ credits: 10 });
    mockClaude(500);

    const res = await scanRequest(key);
    expect(res.status).toBe(502);
    expect((await license(key)).credits_remaining).toBe(10);
    expect((await ledger(key)).map((t) => t.reason)).toEqual(['scan:job-red-flags', 'refund:api_error']);
  });

  it('refunds the credit when Claude returns 200 with unusable content', async () => {
    const key = await seedLicense({ credits: 10 });
    mockClaude(200, { content: [{ text: 'I cannot analyze this.' }] });

    const res = await scanRequest(key);
    expect(res.status).toBe(502);
    expect((await license(key)).credits_remaining).toBe(10);
  });

  it('rejects a key from a different product without touching credits', async () => {
    const key = await seedLicense({ product: 'tos-scanner', credits: 10 });
    const res = await scanRequest(key); // type job-red-flags vs tos-scanner key
    expect(res.status).toBe(401);
    expect((await license(key)).credits_remaining).toBe(10);
    expect(await ledger(key)).toHaveLength(0);
  });

  it('rejects a suspended license', async () => {
    const key = await seedLicense({ credits: 10, status: 'suspended' });
    const res = await scanRequest(key);
    expect(res.status).toBe(403);
    expect((await license(key)).credits_remaining).toBe(10);
  });
});

describe('Gumroad sale webhook', () => {
  const salePing = (form, token = 'gumroad-dummy-token') =>
    SELF.fetch(`https://api.test/webhooks/gumroad/sale?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });

  const validSale = (saleId) => ({
    sale_id: saleId,
    email: 'kitbuyer@example.com',
    seller_id: 'idQwRwHy0WbYATtaNfsC6A==',
    product_permalink: 'chrome-extension-kit',
    'variants[Tier]': 'Pro',
    price: '199',
    'custom_fields[GitHub username]': 'octocat',
  });

  it('rejects a wrong token', async () => {
    const res = await salePing(validSale('sale_auth_1'), 'wrong-token');
    expect(res.status).toBe(401);
    const row = await env.DB.prepare('SELECT id FROM kit_purchases WHERE sale_id = ?').bind('sale_auth_1').first();
    expect(row).toBeNull();
  });

  it('rejects a seller_id mismatch even with a valid token', async () => {
    const res = await salePing({ ...validSale('sale_seller_1'), seller_id: 'someone-else' });
    expect(res.status).toBe(401);
    const row = await env.DB.prepare('SELECT id FROM kit_purchases WHERE sale_id = ?').bind('sale_seller_1').first();
    expect(row).toBeNull();
  });

  it('records the purchase, resolves the tier from the version, invites on GitHub, and dedupes replays', async () => {
    let githubCalls = 0;
    server.use(
      http.put('https://api.github.com/repos/andreaszurhaar/chrome-extension-kit-template/collaborators/octocat', () => {
        githubCalls++;
        return HttpResponse.json({ id: 12345 }, { status: 201 });
      })
    );

    const res = await salePing(validSale('sale_ok_1'));
    expect(res.status).toBe(200);

    const row = await env.DB.prepare('SELECT * FROM kit_purchases WHERE sale_id = ?').bind('sale_ok_1').first();
    expect(row.tier).toBe('pro');
    expect(row.github_username).toBe('octocat');
    expect(row.invite_status).toBe('invited');
    expect(row.amount_cents).toBe(19900);
    expect(githubCalls).toBe(1);

    // Replay: dedupe on sale_id, no second GitHub call, no second row.
    const replay = await salePing(validSale('sale_ok_1'));
    expect((await replay.json()).already_processed).toBe(true);
    expect(githubCalls).toBe(1);
    const { results } = await env.DB.prepare('SELECT id FROM kit_purchases WHERE sale_id = ?').bind('sale_ok_1').all();
    expect(results).toHaveLength(1);
  });
});

describe('admin auth', () => {
  it('rejects a wrong admin key', async () => {
    const res = await SELF.fetch('https://api.test/api/admin/delete-customer', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer wrong-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com' }),
    });
    expect(res.status).toBe(401);
  });
});
