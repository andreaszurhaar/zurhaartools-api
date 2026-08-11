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

// Chrome Web Store + Edge Add-ons URLs per product.
// Used by purchase + recovery email templates to send customers to the right
// install page. Falls back to https://zurhaartools.com if a product has no
// links yet (extension still in review).
const STORE_LINKS = {
  'job-red-flag-detector': {
    chrome: 'https://chromewebstore.google.com/detail/job-red-flag-detector/opcklnckbijmdlmdjgmhdnkclkehemni',
    edge: 'https://microsoftedge.microsoft.com/addons/detail/job-red-flag-detector/nnppdamkeahgdhcgjcfijjeapcijngpk',
  },
  'tos-scanner': {
    chrome: 'https://chromewebstore.google.com/detail/tos-scanner/kcmipgpdgnphnjjeppflojmoecllppmb',
    // TODO(andreas): add Edge URL once Edge approves.
    // Format: https://microsoftedge.microsoft.com/addons/detail/tos-scanner/<extension-id>
    edge: null,
  },
};

// Renders the "Install the extension: Chrome or Edge" line for a product.
// If links are not yet available, falls back to a generic zurhaartools.com link
// so the email still makes sense before the store listings go live.
function renderStoreLinks(product) {
  const links = STORE_LINKS[product];
  if (links && links.chrome && links.edge) {
    return `<a href="${links.chrome}" style="color: #fb923c;">Chrome</a> or <a href="${links.edge}" style="color: #fb923c;">Edge</a>`;
  }
  if (links && links.chrome) {
    return `<a href="${links.chrome}" style="color: #fb923c;">Chrome Web Store</a>`;
  }
  if (links && links.edge) {
    return `<a href="${links.edge}" style="color: #fb923c;">Edge Add-ons</a>`;
  }
  return `<a href="https://zurhaartools.com" style="color: #fb923c;">zurhaartools.com</a>`;
}

// Maps Stripe price IDs to credit amounts and product info
const STRIPE_PRICES = {
  // Test prices
  'price_1TQmUD2OmqjfvJPqWpjGA7PV': { credits: 50, product: 'job-red-flag-detector', variant: '50 Scans' },
  'price_1TQmUE2OmqjfvJPqNVYjk4JV': { credits: 150, product: 'job-red-flag-detector', variant: '150 Scans' },
  'price_1TQmUE2OmqjfvJPqUXdldl3e': { credits: 500, product: 'job-red-flag-detector', variant: '500 Scans' },
  // Job Red Flag Detector — Live prices (old, keep for in-flight purchases)
  'price_1TQoOk2OmqjfvJPqDzWnbzWZ': { credits: 50, product: 'job-red-flag-detector', variant: '50 Scans' },
  'price_1TQoOk2OmqjfvJPq844bFp1N': { credits: 150, product: 'job-red-flag-detector', variant: '150 Scans' },
  'price_1TQoOk2OmqjfvJPqB8j6OW4J': { credits: 500, product: 'job-red-flag-detector', variant: '500 Scans' },
  // Job Red Flag Detector — Live prices (new, single product)
  'price_1TVssD2OmqjfvJPqRaROgekv': { credits: 50, product: 'job-red-flag-detector', variant: '50 Scans' },
  'price_1TVssE2OmqjfvJPq7M4Id0Vd': { credits: 150, product: 'job-red-flag-detector', variant: '150 Scans' },
  'price_1TVssF2OmqjfvJPqcH8wgnqO': { credits: 500, product: 'job-red-flag-detector', variant: '500 Scans' },
  // ToS Scanner — Live prices
  'price_1TVsfi2OmqjfvJPqm3IFIWzF': { credits: 50, product: 'tos-scanner', variant: '50 Scans' },
  'price_1TVsfj2OmqjfvJPqZG5iOqev': { credits: 150, product: 'tos-scanner', variant: '150 Scans' },
  'price_1TVsfk2OmqjfvJPqY6AVUXb1': { credits: 500, product: 'tos-scanner', variant: '500 Scans' },
};

const PROMPTS = {
  'job-red-flags': `You are an expert career advisor. Analyze the following job posting and identify red flags that job seekers should be aware of.

For each red flag found, provide:
- The exact text from the posting
- What it likely means in practice
- A severity level: "high", "medium", or "low"

Also provide an overall score from 1-10 (1 = many red flags, 10 = looks great) and a one-sentence summary.

List only the most significant findings: at most 6 red flags and 4 green flags, ordered by importance. Keep each quote under 25 words, each explanation to one sentence, and the summary to one sentence.

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

  'tos-scan': `You are a consumer rights expert. Analyze the following Terms of Service or Privacy Policy and identify red flags and green flags for the user.

For each red flag found, provide:
- The exact text from the document (summarized if very long)
- What it means in plain language for the user
- A severity level: "high", "medium", or "low"

Also provide an overall fairness score from 1-10 (1 = many red flags, 10 = very fair) and a one-paragraph plain-language summary of the terms.

List only the most significant findings: at most 6 red flags and 4 green flags, ordered by severity. Keep each quote under 25 words, each explanation to one sentence, and the summary to two sentences.

Red flags to look for:
- Data sharing with third parties or selling user data
- Broad license to user content (IP rights grab)
- Liability waivers or limitation of damages
- Unilateral right to change terms without notice
- Auto-renewal or difficult cancellation
- Binding arbitration or class action waiver
- Jurisdiction in unfavorable locations
- Broad data retention or vague deletion policy
- Broad indemnification clauses

Green flags to look for:
- Clear data deletion or right to erasure
- No data selling
- Transparent data practices
- Easy cancellation
- Money-back guarantee or refund policy
- Clear contact information
- GDPR or privacy law compliance
- Open source components disclosed

Respond in JSON format:
{
  "score": number,
  "summary": "string",
  "redFlags": [
    {
      "text": "exact quote from document",
      "meaning": "what this means for the user",
      "severity": "high|medium|low"
    }
  ],
  "greenFlags": [
    {
      "text": "exact quote from document",
      "meaning": "why this is good for the user"
    }
  ]
}

Only respond with valid JSON, no other text.

Text to analyze:
`,
};

// Refund one scan credit + ledger row atomically. Used when the Claude call
// fails after the credit was already deducted.
async function refundScanCredit(env, licenseKey) {
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE licenses SET credits_remaining = credits_remaining + 1 WHERE license_key = ?'
    ).bind(licenseKey),
    env.DB.prepare(
      'INSERT INTO credit_transactions (license_key, change, reason) VALUES (?, 1, ?)'
    ).bind(licenseKey, 'refund:api_error'),
  ]);
}

// Constant-time comparison for secrets (Workers-specific
// crypto.subtle.timingSafeEqual). Length mismatch returns false without the
// timing-safe path — only content comparison leaks timing.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

// ──────────────────────────────────────────────
// Chrome Extension Kit (Gumroad → GitHub) constants
// ──────────────────────────────────────────────
// Hard-coded per V9 brief: the kit only ships from one repo. If we ever sell
// multiple kit repos, store these on the kit_purchases row at sale time.
const KIT_REPO_OWNER = 'andreaszurhaar';
const KIT_REPO_NAME = 'chrome-extension-kit-template';
const KIT_GITHUB_UA = 'zurhaartools-kit-invite/1.0';

// Our Gumroad account's seller_id (public identifier, see ZURHAARTOOLS.md
// Business Identifiers). Pings carrying a different seller_id are rejected —
// second factor next to the URL token.
const GUMROAD_SELLER_ID = 'idQwRwHy0WbYATtaNfsC6A==';

// Shared auth gate for the three Gumroad webhook routes.
// Returns an error Response, or null when the request is authentic.
function gumroadAuthError(url, form, env, origin, routeTag) {
  if (!env.GUMROAD_PING_TOKEN) {
    console.error(`[${routeTag}] GUMROAD_PING_TOKEN not configured`);
    return jsonResponse({ error: 'Webhook not configured' }, 500, origin);
  }
  if (!timingSafeEqual(url.searchParams.get('token') || '', env.GUMROAD_PING_TOKEN)) {
    console.warn(`[${routeTag}] Bad/missing token`);
    return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  }
  const sellerId = form['seller_id'];
  if (sellerId && sellerId !== GUMROAD_SELLER_ID) {
    console.warn(`[${routeTag}] seller_id mismatch: ${String(sellerId).slice(0, 40)}`);
    return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  }
  return null;
}

// Map Gumroad product_permalink → kit tier. Add new permalinks as we publish
// additional tiers on Gumroad. Falls back to null (recorded as-is).
const KIT_TIER_FOR_PERMALINK = {
  'chrome-extension-kit-starter': 'starter',
  'chrome-extension-kit-pro': 'pro',
  'chrome-extension-kit-studio': 'studio',
  // Fallback for a single product with versions — the real tier comes from the
  // chosen version instead (see resolveKitTier).
  'chrome-extension-kit': 'starter',
};

// Resolve the kit tier from a Gumroad sale ping. Supports both store layouts:
//   - one product per tier   → tier comes from product_permalink
//   - one product, 3 versions → tier comes from the chosen version, which
//     Gumroad serialises as `variants[<category>]=<option>` (e.g. variants[Tier]=Pro)
// A per-tier permalink wins; otherwise read the version option's name.
function resolveKitTier(form, productPermalink) {
  const byPermalink = KIT_TIER_FOR_PERMALINK[productPermalink];
  if (byPermalink && productPermalink !== 'chrome-extension-kit') return byPermalink;
  for (const key of Object.keys(form)) {
    if (!/^variants\[.+\]$/.test(key)) continue;
    const v = String(form[key]).toLowerCase();
    if (v.includes('studio')) return 'studio';
    if (v.includes('pro')) return 'pro';
    if (v.includes('starter')) return 'starter';
  }
  return byPermalink || null;
}

// GitHub username rules: 1–39 chars, alphanumeric + single hyphens, can't
// start/end with hyphen. See docs.github.com/en/admin/identity-and-access-management.
const GITHUB_USERNAME_REGEX = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/;

function normalizeGithubUsername(raw) {
  if (typeof raw !== 'string') return null;
  let u = raw.trim().toLowerCase();
  if (!u) return null;
  // Strip leading @
  if (u.startsWith('@')) u = u.slice(1);
  // Strip github URL prefixes (with or without protocol)
  u = u.replace(/^https?:\/\/(?:www\.)?github\.com\//, '');
  u = u.replace(/^github\.com\//, '');
  // Strip trailing slash / path segments (e.g. someone pastes a repo URL)
  u = u.split('/')[0];
  if (!GITHUB_USERNAME_REGEX.test(u)) return null;
  return u;
}

// Parses Gumroad's form-encoded Ping body. Gumroad serialises custom checkout
// fields as bracket keys, e.g. `custom_fields[GitHub username]=octocat`.
// URLSearchParams handles the bracket keys as opaque key strings, which is
// what we want. Returns a Map<string, string> (first value wins on duplicates).
function parseFormBody(raw) {
  const params = new URLSearchParams(raw);
  const out = {};
  for (const [k, v] of params.entries()) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}

// Extracts the GitHub username from a parsed Gumroad form payload.
// Gumroad allows the seller to label the custom field; we try the common
// labels (`GitHub username`, `Github Username`, etc.) and fall back to a
// case-insensitive scan over `custom_fields[*]` keys.
function extractGithubUsernameFromForm(form) {
  const candidates = [
    'custom_fields[GitHub username]',
    'custom_fields[Github Username]',
    'custom_fields[github username]',
    'custom_fields[GitHub Username]',
    'custom_fields[github_username]',
  ];
  for (const key of candidates) {
    if (form[key]) return form[key];
  }
  // Case-insensitive scan for any custom_fields[*] containing "github"
  for (const key of Object.keys(form)) {
    const m = key.match(/^custom_fields\[(.+)\]$/);
    if (m && /github/i.test(m[1])) return form[key];
  }
  return null;
}

// ──────────────────────────────────────────────
// GitHub API helpers (collaborator management)
// ──────────────────────────────────────────────
// addCollaborator: PUT /repos/{owner}/{repo}/collaborators/{username}
// Returns one of:
//   { status: 'invited', invite_id: number }    — 201, invitation created
//   { status: 'already_active' }                — 204, already a collaborator
//   { status: 'bad_username' }                  — 404, GitHub user does not exist
//   { status: 'blocked', detail: string }       — 422, spam/validation flag
//   { status: 'error', http_status, detail }    — other failures (caller decides)
async function addCollaborator(username, env) {
  if (!env.GITHUB_KIT_PAT) {
    return { status: 'error', http_status: 0, detail: 'GITHUB_KIT_PAT not configured' };
  }
  const url = `https://api.github.com/repos/${KIT_REPO_OWNER}/${KIT_REPO_NAME}/collaborators/${encodeURIComponent(username)}`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_KIT_PAT}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': KIT_GITHUB_UA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ permission: 'pull' }),
    });
  } catch (e) {
    return { status: 'error', http_status: 0, detail: e.message || String(e) };
  }

  if (resp.status === 201) {
    let invite_id = null;
    try {
      const body = await resp.json();
      invite_id = typeof body?.id === 'number' ? body.id : null;
    } catch { /* body may be empty under rare conditions */ }
    return { status: 'invited', invite_id, http_status: 201 };
  }
  if (resp.status === 204) {
    return { status: 'already_active', http_status: 204 };
  }
  if (resp.status === 404) {
    return { status: 'bad_username', http_status: 404 };
  }
  if (resp.status === 422) {
    const detail = await resp.text().catch(() => '');
    return { status: 'blocked', http_status: 422, detail };
  }
  const detail = await resp.text().catch(() => '');
  return { status: 'error', http_status: resp.status, detail };
}

// removeCollaborator: DELETE /repos/{owner}/{repo}/collaborators/{username}
// Idempotent — 204 (removed) and 404 (not a collaborator) are both fine.
async function removeCollaborator(username, env) {
  if (!env.GITHUB_KIT_PAT) {
    return { status: 'error', http_status: 0, detail: 'GITHUB_KIT_PAT not configured' };
  }
  const url = `https://api.github.com/repos/${KIT_REPO_OWNER}/${KIT_REPO_NAME}/collaborators/${encodeURIComponent(username)}`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_KIT_PAT}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': KIT_GITHUB_UA,
      },
    });
  } catch (e) {
    return { status: 'error', http_status: 0, detail: e.message || String(e) };
  }
  if (resp.status === 204 || resp.status === 404) {
    return { status: 'removed', http_status: resp.status };
  }
  const detail = await resp.text().catch(() => '');
  return { status: 'error', http_status: resp.status, detail };
}

// cancelInvitation: DELETE /repos/{owner}/{repo}/invitations/{invitation_id}
//
// This is NOT the same as removeCollaborator. Removing a collaborator only
// affects someone who has ACCEPTED their invite; a still-pending invitation
// survives it and stays acceptable afterwards. Both endpoints answer 204, so
// revoking via removeCollaborator alone looks successful while leaving the
// buyer a live invite — i.e. refund the purchase, then accept and keep access.
// Idempotent: 404 means the invite was already accepted, cancelled, or expired.
async function cancelInvitation(invitationId, env) {
  if (!env.GITHUB_KIT_PAT) {
    return { status: 'error', http_status: 0, detail: 'GITHUB_KIT_PAT not configured' };
  }
  const url = `https://api.github.com/repos/${KIT_REPO_OWNER}/${KIT_REPO_NAME}/invitations/${encodeURIComponent(invitationId)}`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_KIT_PAT}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': KIT_GITHUB_UA,
      },
    });
  } catch (e) {
    return { status: 'error', http_status: 0, detail: e.message || String(e) };
  }
  if (resp.status === 204 || resp.status === 404) {
    return { status: 'cancelled', http_status: resp.status };
  }
  const detail = await resp.text().catch(() => '');
  return { status: 'error', http_status: resp.status, detail };
}

// Full access revocation for refund / dispute. A buyer is in exactly one of two
// states and we cannot reliably tell which from our side, so do both:
//   - invite still pending  -> cancelInvitation() by stored invite id
//   - invite accepted       -> removeCollaborator() by username
// Callers must SELECT github_invite_id for the pending case to be reachable.
async function revokeKitAccess(purchase, env) {
  const cancelResult = purchase.github_invite_id
    ? await cancelInvitation(purchase.github_invite_id, env)
    : null;
  const removeResult = purchase.github_username
    ? await removeCollaborator(purchase.github_username, env)
    : null;
  return { cancelResult, removeResult };
}

// ──────────────────────────────────────────────
// Kit email templates (Resend)
// ──────────────────────────────────────────────
// Welcome email sent after a successful Gumroad sale + GitHub invite.
// `inviteOutcome` is the result of addCollaborator() so the copy can adapt to
// already-active vs. bad-username vs. happy-path.
function renderKitPurchaseEmail({ email, githubUsername, tier, inviteOutcome }) {
  const tierLabel = tier ? `${tier.charAt(0).toUpperCase()}${tier.slice(1)} tier` : 'Chrome Extension Kit';
  const inviteUrl = 'https://github.com/' + KIT_REPO_OWNER + '/' + KIT_REPO_NAME + '/invitations';
  const repoUrl = 'https://github.com/' + KIT_REPO_OWNER + '/' + KIT_REPO_NAME;
  const redeemUrl = 'https://zurhaartools.com/kit/redeem';

  let inviteBlock;
  if (inviteOutcome?.status === 'invited') {
    inviteBlock = `<p>We've sent a GitHub invitation to <strong>${escapeHtml(githubUsername)}</strong>. Accept it here:</p>
  <p style="margin: 16px 0;"><a href="${inviteUrl}" style="background: #f97316; color: #ffffff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Accept your invitation on GitHub</a></p>
  <p style="color: #94a3b8; font-size: 14px;">Once accepted, clone the kit:</p>
  <pre style="background: #12121a; color: #e2e8f0; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 13px;">git clone git@github.com:${KIT_REPO_OWNER}/${KIT_REPO_NAME}.git</pre>`;
  } else if (inviteOutcome?.status === 'already_active') {
    inviteBlock = `<p>You're already a collaborator on the repo — nothing more to do. Open it here:</p>
  <p style="margin: 16px 0;"><a href="${repoUrl}" style="background: #f97316; color: #ffffff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Open the Chrome Extension Kit</a></p>`;
  } else if (inviteOutcome?.status === 'bad_username') {
    inviteBlock = `<p>We couldn't find a GitHub user matching <strong>${escapeHtml(githubUsername || '(none provided)')}</strong>. No problem — submit the correct username here and we'll send the invitation right away:</p>
  <p style="margin: 16px 0;"><a href="${redeemUrl}" style="background: #f97316; color: #ffffff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Submit your GitHub username</a></p>
  <p style="color: #94a3b8; font-size: 14px;">Don't have a GitHub account yet? <a href="https://github.com/join" style="color: #fb923c;">Create one free at github.com/join</a>, then come back to the link above.</p>`;
  } else {
    inviteBlock = `<p>We hit a snag sending your GitHub invitation. Don't worry — your purchase is recorded. Submit your GitHub username here and we'll retry:</p>
  <p style="margin: 16px 0;"><a href="${redeemUrl}" style="background: #f97316; color: #ffffff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Submit your GitHub username</a></p>`;
  }

  return {
    subject: 'Welcome — your Chrome Extension Kit is ready',
    html: `<div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px; color: #1f2937;">
  <h2 style="color: #f97316;">Welcome to the Chrome Extension Kit</h2>
  <p>Thanks for buying the <strong>${escapeHtml(tierLabel)}</strong>. You now have lifetime access to the private kit repo, including every update we ship.</p>
  ${inviteBlock}
  <h3 style="margin-top: 28px;">Start here</h3>
  <ol>
    <li>Accept the GitHub invite (above)</li>
    <li>Clone the repo locally</li>
    <li>Read <code>docs/00-quickstart.md</code> — it walks you from clone to a working extension in about 30 minutes</li>
  </ol>
  <p style="color: #94a3b8; font-size: 14px; margin-top: 24px;">Lifetime access means lifetime updates. As new docs and patterns ship, just <code>git pull</code> — no re-purchase needed.</p>
  <p style="color: #94a3b8; font-size: 14px; margin-top: 30px;">Need help? Reply to this email or contact <a href="mailto:andreas@zurhaartools.com" style="color: #fb923c;">andreas@zurhaartools.com</a></p>
  <p style="color: #94a3b8; font-size: 12px;">Zurhaar Tools — <a href="https://zurhaartools.com" style="color: #fb923c;">zurhaartools.com</a></p>
</div>`,
  };
}

// Refund-processed email. No-shame tone per V9 brief.
function renderKitRefundEmail({ email, tier }) {
  const tierLabel = tier ? `${tier.charAt(0).toUpperCase()}${tier.slice(1)} tier` : 'Chrome Extension Kit';
  return {
    subject: 'Your refund is processed',
    html: `<div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px; color: #1f2937;">
  <h2 style="color: #f97316;">Refund processed</h2>
  <p>Your refund for the <strong>${escapeHtml(tierLabel)}</strong> has been processed. The amount will land on your card or PayPal within a few business days, depending on your bank.</p>
  <p>As part of the refund we've removed your access to the private kit repo on GitHub. No hard feelings — the kit wasn't right for you this time.</p>
  <p>You're welcome back any time. If something specific was missing or didn't work for you, a one-line reply with what would have helped is genuinely useful — no obligation.</p>
  <p style="color: #94a3b8; font-size: 14px; margin-top: 30px;">Questions? Reply to this email or contact <a href="mailto:andreas@zurhaartools.com" style="color: #fb923c;">andreas@zurhaartools.com</a></p>
  <p style="color: #94a3b8; font-size: 12px;">Zurhaar Tools — <a href="https://zurhaartools.com" style="color: #fb923c;">zurhaartools.com</a></p>
</div>`,
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Append a row to kit_events. Best-effort — failures are logged, never thrown.
async function logKitEvent(env, { kit_purchase_id, sale_id, event_type, github_status, event_data }) {
  try {
    await env.DB.prepare(
      'INSERT INTO kit_events (kit_purchase_id, sale_id, event_type, github_status, event_data) VALUES (?, ?, ?, ?, ?)'
    ).bind(
      kit_purchase_id ?? null,
      sale_id,
      event_type,
      typeof github_status === 'number' ? github_status : null,
      event_data ? (typeof event_data === 'string' ? event_data : JSON.stringify(event_data)) : null
    ).run();
  } catch (e) {
    console.error(`[KIT_EVENT_ERROR] Failed to write kit_events row | sale=${sale_id} type=${event_type}`, e.message || e);
  }
}

// Send a Resend email. Best-effort: returns true/false but never throws.
async function sendResendEmail(env, { to, subject, html }) {
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Zurhaar Tools <andreas@zurhaartools.com>',
        to, subject, html,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.error(`[KIT_EMAIL_ERROR] Resend ${resp.status} | to=${to} subject="${subject}"`, txt);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[KIT_EMAIL_ERROR] Resend fetch failed | to=${to} subject="${subject}"`, e.message || e);
    return false;
  }
}

// Mirror a kit refund to Google Sheets (parallel to scanner refunds).
async function logKitRefundToSheets(env, { sale_id, tier, amount_cents, currency, test_mode }) {
  if (!env.SHEETS_ENABLED || env.SHEETS_ENABLED !== 'true') return;
  if (!env.GOOGLE_SHEETS_URL) return;
  try {
    await fetch(env.GOOGLE_SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: new Date().toISOString().substring(0, 10),
        order_id: sale_id,
        product: tier ? `Chrome Extension Kit (${tier})` : 'Chrome Extension Kit',
        variant: 'Refund',
        amount: -((amount_cents || 0) / 100),
        email: '',
        test_mode: test_mode ? 'Yes' : 'No',
        country: '',
        currency: (currency || 'eur').toUpperCase(),
      }),
      redirect: 'follow',
    });
  } catch (e) {
    console.error(`[KIT_SHEETS_ERROR] Failed to log kit refund | sale=${sale_id}`, e.message || e);
  }
}

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

  await env.DB.batch([
    env.DB.prepare(
      'UPDATE licenses SET credits_remaining = ?, status = ?, updated_at = datetime(\'now\') WHERE license_key = ?'
    ).bind(newCredits, newStatus, licenseKey),
    env.DB.prepare(
      'INSERT INTO credit_transactions (license_key, change, reason, order_id) VALUES (?, ?, ?, ?)'
    ).bind(licenseKey, -creditsToDeduct, `refund:${chargeId}`, chargeId),
  ]);

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
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE licenses SET credits_remaining = 0, status = \'revoked\', updated_at = datetime(\'now\') WHERE license_key = ?'
    ).bind(licenseKey),
    env.DB.prepare(
      'INSERT INTO credit_transactions (license_key, change, reason, order_id) VALUES (?, ?, ?, ?)'
    ).bind(licenseKey, -creditsRevoked, `chargeback:${disputeId}`, disputeId),
  ]);

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

  await env.DB.batch([
    env.DB.prepare(
      'UPDATE licenses SET credits_remaining = credits_remaining + ?, status = \'active\', updated_at = datetime(\'now\') WHERE license_key = ?'
    ).bind(creditsToRestore, licenseKey),
    env.DB.prepare(
      'INSERT INTO credit_transactions (license_key, change, reason, order_id) VALUES (?, ?, ?, ?)'
    ).bind(licenseKey, creditsToRestore, `chargeback_reversed:${disputeId}`, disputeId),
  ]);

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
          if (sig && timingSafeEqual(expected, sig)) {
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

        // Extract withdrawal-right waiver acknowledgement from the Stripe
        // Payment Link custom field (configured in Stripe Dashboard).
        // Stripe Payment Links currently support dropdown/numeric/text custom
        // field types (no checkbox). We use a required dropdown with a single
        // 'agree' option; selecting it constitutes the express opt-in.
        // We still accept a checkbox shape defensively in case Stripe adds it.
        let waiverAcknowledgedAt = null;
        let waiverText = null;
        const customFields = Array.isArray(session.custom_fields) ? session.custom_fields : [];
        const waiverField = customFields.find(f => (f?.key || '').toLowerCase().startsWith('waiver'));
        if (waiverField) {
          const isCheckedCheckbox = waiverField.type === 'checkbox' && waiverField.checkbox?.value === 'checked';
          const dropdownValue = waiverField.dropdown?.value;
          const isAgreedDropdown = waiverField.type === 'dropdown' && typeof dropdownValue === 'string' && dropdownValue.length > 0;
          if (isCheckedCheckbox || isAgreedDropdown) {
            waiverAcknowledgedAt = new Date().toISOString();
            const fieldLabel = waiverField.label?.custom || '';
            if (isAgreedDropdown) {
              const selectedOption = (waiverField.dropdown?.options || []).find(o => o?.value === dropdownValue);
              const optionLabel = selectedOption?.label || '';
              waiverText = [fieldLabel, optionLabel].filter(Boolean).join(' — ') || null;
            } else {
              waiverText = fieldLabel || null;
            }
          }
        }
        if (!waiverAcknowledgedAt) {
          console.warn(`[WAIVER_MISSING] No waiver acknowledgement on session=${sessionId}. Configure waiver custom field on the Payment Link in Stripe Dashboard.`);
        }

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
        let licenseStmt;

        if (existingLicense) {
          licenseKey = existingLicense.license_key;
          // Reactivate suspended licenses on new purchase (but not revoked — chargebacks stay revoked)
          const newStatus = existingLicense.status === 'suspended' ? 'active' : existingLicense.status;
          // Persist the latest waiver acknowledgement on top-up, only when present
          // (the consumer ticked the box on this purchase). COALESCE preserves the
          // most recent prior waiver if this session lacked one.
          licenseStmt = env.DB.prepare(
            'UPDATE licenses SET credits_remaining = credits_remaining + ?, status = ?, waiver_acknowledged_at = COALESCE(?, waiver_acknowledged_at), waiver_text = COALESCE(?, waiver_text), updated_at = datetime(\'now\') WHERE license_key = ?'
          ).bind(credits, newStatus, waiverAcknowledgedAt, waiverText, licenseKey);
        } else {
          licenseKey = crypto.randomUUID().toUpperCase();
          licenseStmt = env.DB.prepare(
            'INSERT INTO licenses (license_key, product, email, credits_remaining, waiver_acknowledged_at, waiver_text) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(licenseKey, product, email, credits, waiverAcknowledgedAt, waiverText);
        }

        // Credit grant + ledger row in one transaction: a partial write here
        // would dodge the idempotency check (keyed on the ledger row) and
        // double-credit on Stripe's retry.
        await env.DB.batch([
          licenseStmt,
          env.DB.prepare(
            'INSERT INTO credit_transactions (license_key, change, reason, order_id) VALUES (?, ?, ?, ?)'
          ).bind(licenseKey, credits, `purchase:${credits}`, sessionId),
        ]);

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
        // Echo the withdrawal-right waiver back to the consumer (art. 6:230v lid 7 BW).
        // Use the exact text the consumer agreed to. If no waiver was captured
        // (Payment Link not yet configured with the checkbox), omit the section.
        const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const waiverSection = waiverText
          ? `<div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 16px; margin: 0 0 20px 0; color: #1f2937; font-size: 14px;">
    <p style="margin: 0 0 8px 0; font-weight: 600; color: #c2410c;">Belangrijke informatie over uw herroepingsrecht</p>
    <p style="margin: 0 0 8px 0;">U heeft bij het bestellen ingestemd met de directe levering en daarmee uitdrukkelijk verklaard afstand te doen van uw 14-daagse herroepingsrecht. De volgende verklaring heeft u geaccepteerd:</p>
    <p style="margin: 0 0 8px 0; font-style: italic;">&ldquo;${escapeHtml(waiverText)}&rdquo;</p>
    <p style="margin: 0;">Bij vragen over uw bestelling kunt u contact opnemen via <a href="mailto:support@zurhaartools.com" style="color: #c2410c;">support@zurhaartools.com</a>.</p>
  </div>`
          : '';
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
  ${waiverSection}
  <h2 style="color: #f97316;">Thanks for your purchase!</h2>
  <p>Here is your license key for the <strong>${productName}</strong>:</p>
  <div style="background: #12121a; border: 1px solid #2e2e42; border-radius: 8px; padding: 16px; margin: 20px 0;">
    <code style="color: #fb923c; font-size: 16px; word-break: break-all;">${licenseKey}</code>
  </div>
  <p><strong>Credits:</strong> ${totalCredits} scans available</p>
  <h3>How to use</h3>
  <ol>
    <li>Install the extension: ${renderStoreLinks(product)}</li>
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
              // Capped at 1500: the prompts limit output to ≤6 red + 4 green flags
              // (~800 tokens typical), so this is a safety ceiling that bounds
              // per-scan cost (~€0.012 worst case) without truncating normal responses.
              max_tokens: 1500,
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
          await refundScanCredit(env, license_key);
          console.error(`[SCAN_ERROR] Claude API unreachable | type=${type} key=${license_key}`, fetchErr.message || fetchErr);
          return jsonResponse({ error: 'Analysis service temporarily unavailable' }, 502, origin);
        }

        if (!claudeResponse.ok) {
          // Claude API error — refund the credit
          await refundScanCredit(env, license_key);
          const errorText = await claudeResponse.text();
          console.error(`[SCAN_ERROR] Claude API error ${claudeResponse.status} | type=${type} key=${license_key}`, errorText);
          return jsonResponse({ error: 'Analysis service temporarily unavailable' }, 502, origin);
        }

        const result = await claudeResponse.json().catch(() => null);
        const content = result?.content?.[0]?.text;

        // Parse the JSON response from Claude
        let parsed;
        if (typeof content === 'string') {
          try {
            let text = content.trim();
            // Strip markdown code fences if present
            const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (fenceMatch) {
              text = fenceMatch[1].trim();
            }
            parsed = JSON.parse(text);
          } catch {
            try {
              const jsonMatch = content.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
              }
            } catch {
              // Falls through to the unusable-response refund below
            }
          }
        }

        if (!parsed || typeof parsed !== 'object') {
          // Claude returned 200 but nothing usable (refusal, empty/non-text
          // content, or unparseable output) — refund the credit
          await refundScanCredit(env, license_key);
          console.error(`[SCAN_ERROR] Claude response unusable | type=${type} key=${license_key} stop_reason=${result?.stop_reason ?? 'n/a'} has_content=${typeof content === 'string'}`);
          return jsonResponse({ error: 'Analysis service temporarily unavailable' }, 502, origin);
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
        // Per-IP rate limit — unauthenticated endpoint that sends email
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const { success } = await env.EMAIL_RATE_LIMITER.limit({ key: ip });
        if (!success) {
          return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, origin);
        }

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

        // Build license list HTML — install link per card so multi-product
        // recoveries point each license at its own store listing.
        const licenseListHtml = licenses.results.map(l => {
          const displayName = PRODUCT_DISPLAY_NAMES[l.product] || l.product;
          return `<div style="background: #12121a; border: 1px solid #2e2e42; border-radius: 8px; padding: 16px; margin: 12px 0;">
    <p style="margin: 0 0 8px 0; color: #e2e8f0;"><strong>${displayName}</strong></p>
    <code style="color: #fb923c; font-size: 16px; word-break: break-all;">${l.license_key}</code>
    <p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 14px;">${l.credits_remaining} scans remaining</p>
    <p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 14px;">Install: ${renderStoreLinks(l.product)}</p>
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
  <p>Here are the license keys associated with your email. Open the extension, paste the matching key, and you're back in.</p>
  ${licenseListHtml}
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
      if (!token || !env.ADMIN_API_KEY || !timingSafeEqual(token, env.ADMIN_API_KEY)) {
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

    // ──────────────────────────────────────────────
    // Waitlist signup: collects emails for pre-launch products (Chrome Extension Kit)
    // ──────────────────────────────────────────────
    if (url.pathname === '/api/kit/waitlist' && request.method === 'POST') {
      try {
        // Per-IP rate limit — unauthenticated endpoint that sends email
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const { success } = await env.EMAIL_RATE_LIMITER.limit({ key: ip });
        if (!success) {
          return jsonResponse({ ok: false, error: 'Too many requests. Please try again later.' }, 429, origin);
        }

        const body = await request.json().catch(() => ({}));
        const rawEmail = typeof body.email === 'string' ? body.email : '';
        const email = rawEmail.trim().toLowerCase();
        const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim().slice(0, 64) : null;

        // Practical RFC 5322 lite — local@domain.tld, no spaces, single @
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email) || email.length > 254) {
          return jsonResponse({ ok: false, error: 'Please enter a valid email address.' }, 400, origin);
        }

        // Insert; on duplicate, treat as success (no enumeration leak via UX)
        let inserted = false;
        try {
          const result = await env.DB.prepare(
            'INSERT INTO kit_waitlist (email, source) VALUES (?, ?) ON CONFLICT(email) DO NOTHING'
          ).bind(email, source).run();
          inserted = (result.meta?.changes || 0) > 0;
        } catch (e) {
          console.error(`[WAITLIST_ERROR] DB insert failed | email=${email}`, e.message || e);
          return jsonResponse({ ok: false, error: 'Could not save your email. Please try again.' }, 500, origin);
        }

        // Only send a confirmation email on first signup — repeat submissions stay silent
        // (still 200 OK so the UI is uniform) to avoid spamming and to not leak existence.
        if (inserted) {
          // Global daily cap: past 200 signups in the current UTC day, keep the
          // row but skip the confirmation email — protects the Resend quota and
          // sender reputation against scripted abuse.
          const todaySignups = await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM kit_waitlist WHERE signed_up_at >= datetime('now', 'start of day')"
          ).first();
          if ((todaySignups?.n ?? 0) >= 200) {
            console.warn(`[WAITLIST] Daily email cap reached (${todaySignups?.n} signups today) — confirmation skipped | email=${email}`);
          } else {
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
                  subject: "You're on the list — Chrome Extension Kit",
                  html: `<div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #f97316;">You're on the list</h2>
  <p>Thanks for signing up for the <strong>Chrome Extension Kit</strong> waitlist. We'll email you the moment it launches, including early-bird pricing reserved for people on this list.</p>
  <p style="color: #94a3b8; font-size: 14px; margin-top: 30px;">In the meantime, check out the other Zurhaar Tools:</p>
  <ul style="color: #94a3b8; font-size: 14px; padding-left: 20px;">
    <li><a href="https://zurhaartools.com" style="color: #fb923c;">zurhaartools.com</a> — all products</li>
    <li><a href="https://chromewebstore.google.com/detail/job-red-flag-detector/opcklnckbijmdlmdjgmhdnkclkehemni" style="color: #fb923c;">Job Red Flag Detector</a> — scan job postings for red flags</li>
    <li><a href="https://zurhaartools.com/pricing#tos-scanner" style="color: #fb923c;">ToS Scanner</a> — read what you're agreeing to before you click "Accept"</li>
  </ul>
  <p style="color: #94a3b8; font-size: 12px; margin-top: 30px;">Zurhaar Tools — <a href="https://zurhaartools.com" style="color: #fb923c;">zurhaartools.com</a></p>
</div>`,
                }),
              });
            } catch (e) {
              // Email failure must not fail the request — the signup is saved.
              console.error(`[WAITLIST_EMAIL_ERROR] Failed to send confirmation | email=${email}`, e.message || e);
            }
          }
          console.log(`[WAITLIST] Signup recorded | email=${email} source=${source || 'none'}`);
        } else {
          console.log(`[WAITLIST] Duplicate signup ignored | email=${email} source=${source || 'none'}`);
        }

        return jsonResponse({ ok: true }, 200, origin);
      } catch (err) {
        console.error(`[WAITLIST_ERROR] Request processing failed`, err.message || err);
        return jsonResponse({ ok: false, error: 'Something went wrong. Please try again.' }, 500, origin);
      }
    }

    // ──────────────────────────────────────────────
    // Gumroad webhook: sale ping → kit_purchases + GitHub collaborator invite
    // ──────────────────────────────────────────────
    // Auth model: URL-secret token (constant-time compare) + seller_id pin.
    // Gumroad lets us set the Ping URL freely, so we configure it as
    // `.../webhooks/gumroad/sale?token=<GUMROAD_PING_TOKEN>`. Gumroad Ping has
    // no HMAC signing, so the token + seller_id pair is the auth boundary.
    if (url.pathname === '/webhooks/gumroad/sale' && request.method === 'POST') {
      try {
        const rawBody = await request.text();
        const form = parseFormBody(rawBody);
        const authError = gumroadAuthError(url, form, env, origin, 'KIT_SALE_AUTH');
        if (authError) return authError;

        const saleId = form['sale_id'];
        const email = form['email'] ? String(form['email']).trim().toLowerCase() : '';
        if (!saleId || !email) {
          console.error(`[KIT_SALE_ERROR] Missing sale_id or email | body_keys=${Object.keys(form).join(',')}`);
          return jsonResponse({ error: 'Missing sale_id or email' }, 400, origin);
        }

        // Idempotency — return 200 on any second hit for this sale_id.
        const existing = await env.DB.prepare(
          'SELECT id, invite_status FROM kit_purchases WHERE sale_id = ?'
        ).bind(saleId).first();
        if (existing) {
          await logKitEvent(env, {
            kit_purchase_id: existing.id,
            sale_id: saleId,
            event_type: 'sale',
            event_data: { duplicate: true, prior_invite_status: existing.invite_status },
          });
          return jsonResponse({ ok: true, already_processed: true }, 200, origin);
        }

        const productPermalink = form['product_permalink'] || 'chrome-extension-kit';
        const tier = resolveKitTier(form, productPermalink);
        const orderNumber = form['order_number'] || null;
        const licenseKey = form['license_key'] || null;
        const country = form['ip_country'] || form['country'] || null;
        const currency = (form['currency'] || 'eur').toLowerCase();
        // Gumroad sends `price` (cents) and/or `price_in_cents`. Prefer the
        // explicit cents field; fall back to parsing `price` as float * 100.
        let amountCents = 0;
        if (form['price_in_cents']) {
          amountCents = parseInt(form['price_in_cents'], 10) || 0;
        } else if (form['price']) {
          const f = parseFloat(form['price']);
          amountCents = Number.isFinite(f) ? Math.round(f * 100) : 0;
        }
        const testMode = form['test'] === 'true' || form['test'] === '1' ? 1 : 0;

        const rawUsername = extractGithubUsernameFromForm(form);
        const githubUsername = normalizeGithubUsername(rawUsername);

        // Insert the purchase row first so we have an id for event linkage.
        const insertResult = await env.DB.prepare(
          `INSERT INTO kit_purchases
            (sale_id, order_number, license_key, product_permalink, tier, email,
             github_username, amount_cents, currency, country, test_mode, invite_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
        ).bind(
          saleId, orderNumber, licenseKey, productPermalink, tier, email,
          githubUsername, amountCents, currency, country, testMode
        ).run();
        const kitPurchaseId = insertResult.meta?.last_row_id || null;

        await logKitEvent(env, {
          kit_purchase_id: kitPurchaseId,
          sale_id: saleId,
          event_type: 'sale',
          event_data: {
            tier, product_permalink: productPermalink, amount_cents: amountCents,
            currency, country, test_mode: !!testMode,
            raw_github_username: rawUsername, normalized_github_username: githubUsername,
          },
        });

        // If we couldn't extract/normalize a username, mark bad_username and
        // send the recovery email so the buyer can self-serve via /redeem.
        let inviteOutcome;
        if (!githubUsername) {
          inviteOutcome = { status: 'bad_username', http_status: 0 };
          await env.DB.prepare(
            `UPDATE kit_purchases SET invite_status = 'bad_username',
              last_error = ?, updated_at = datetime('now') WHERE id = ?`
          ).bind('No GitHub username in custom_fields, or failed normalization', kitPurchaseId).run();
          await logKitEvent(env, {
            kit_purchase_id: kitPurchaseId,
            sale_id: saleId,
            event_type: 'invite_failed',
            event_data: { reason: 'no_or_invalid_username', raw_github_username: rawUsername },
          });
        } else {
          inviteOutcome = await addCollaborator(githubUsername, env);
          if (inviteOutcome.status === 'invited') {
            await env.DB.prepare(
              `UPDATE kit_purchases SET invite_status = 'invited', github_invite_id = ?,
                last_error = NULL, updated_at = datetime('now') WHERE id = ?`
            ).bind(inviteOutcome.invite_id ?? null, kitPurchaseId).run();
            await logKitEvent(env, {
              kit_purchase_id: kitPurchaseId, sale_id: saleId, event_type: 'invite_sent',
              github_status: inviteOutcome.http_status,
              event_data: { invite_id: inviteOutcome.invite_id, username: githubUsername },
            });
          } else if (inviteOutcome.status === 'already_active') {
            await env.DB.prepare(
              `UPDATE kit_purchases SET invite_status = 'active',
                last_error = NULL, updated_at = datetime('now') WHERE id = ?`
            ).bind(kitPurchaseId).run();
            await logKitEvent(env, {
              kit_purchase_id: kitPurchaseId, sale_id: saleId, event_type: 'invite_already_active',
              github_status: inviteOutcome.http_status,
              event_data: { username: githubUsername },
            });
          } else if (inviteOutcome.status === 'bad_username') {
            await env.DB.prepare(
              `UPDATE kit_purchases SET invite_status = 'bad_username',
                last_error = 'GitHub 404 user not found', updated_at = datetime('now') WHERE id = ?`
            ).bind(kitPurchaseId).run();
            await logKitEvent(env, {
              kit_purchase_id: kitPurchaseId, sale_id: saleId, event_type: 'invite_failed',
              github_status: 404, event_data: { reason: 'user_not_found', username: githubUsername },
            });
          } else if (inviteOutcome.status === 'blocked') {
            await env.DB.prepare(
              `UPDATE kit_purchases SET invite_status = 'blocked',
                last_error = ?, updated_at = datetime('now') WHERE id = ?`
            ).bind((inviteOutcome.detail || '').slice(0, 1000), kitPurchaseId).run();
            await logKitEvent(env, {
              kit_purchase_id: kitPurchaseId, sale_id: saleId, event_type: 'invite_failed',
              github_status: 422,
              event_data: { reason: 'github_validation_or_spam', username: githubUsername, detail: inviteOutcome.detail },
            });
            console.error(`[KIT_SALE_BLOCKED] GitHub 422 for username=${githubUsername} sale=${saleId} — manual review needed`);
          } else {
            // error — set failed; we still return 200 so Gumroad doesn't retry
            // forever for transient GitHub issues. Andreas can re-invite via
            // /api/kit/redeem once GitHub is back.
            await env.DB.prepare(
              `UPDATE kit_purchases SET invite_status = 'failed',
                last_error = ?, updated_at = datetime('now') WHERE id = ?`
            ).bind((inviteOutcome.detail || '').slice(0, 1000), kitPurchaseId).run();
            await logKitEvent(env, {
              kit_purchase_id: kitPurchaseId, sale_id: saleId, event_type: 'invite_failed',
              github_status: inviteOutcome.http_status,
              event_data: { reason: 'github_api_error', username: githubUsername, detail: inviteOutcome.detail },
            });
            console.error(`[KIT_SALE_ERROR] GitHub addCollaborator failed | sale=${saleId} status=${inviteOutcome.http_status}`, inviteOutcome.detail);
          }
        }

        // Send confirmation email (best-effort — failure doesn't fail the request)
        const tmpl = renderKitPurchaseEmail({ email, githubUsername, tier, inviteOutcome });
        await sendResendEmail(env, { to: email, subject: tmpl.subject, html: tmpl.html });

        console.log(`[KIT_SALE] sale=${saleId} email=${email} username=${githubUsername} tier=${tier} invite=${inviteOutcome.status}`);
        return jsonResponse({ ok: true, sale_id: saleId, invite_status: inviteOutcome.status }, 200, origin);
      } catch (err) {
        console.error('[KIT_SALE_ERROR] Sale webhook processing failed', err.message || err, err.stack || '');
        return jsonResponse({ error: 'Webhook processing failed' }, 500, origin);
      }
    }

    // ──────────────────────────────────────────────
    // Gumroad webhook: refund ping → remove collaborator
    // ──────────────────────────────────────────────
    if (url.pathname === '/webhooks/gumroad/refund' && request.method === 'POST') {
      try {
        const rawBody = await request.text();
        const form = parseFormBody(rawBody);
        const authError = gumroadAuthError(url, form, env, origin, 'KIT_REFUND_AUTH');
        if (authError) return authError;
        const saleId = form['sale_id'];
        if (!saleId) {
          return jsonResponse({ error: 'Missing sale_id' }, 400, origin);
        }
        const purchase = await env.DB.prepare(
          'SELECT id, github_username, github_invite_id, tier, email, amount_cents, currency, test_mode, refund_status FROM kit_purchases WHERE sale_id = ?'
        ).bind(saleId).first();
        if (!purchase) {
          console.warn(`[KIT_REFUND] No kit_purchases row for sale=${saleId} — recording event only`);
          await logKitEvent(env, {
            kit_purchase_id: null, sale_id: saleId, event_type: 'refund',
            event_data: { warning: 'no_matching_purchase' },
          });
          return jsonResponse({ ok: true, skipped: true }, 200, origin);
        }
        if (purchase.refund_status === 'refunded') {
          return jsonResponse({ ok: true, already_processed: true }, 200, origin);
        }

        const { cancelResult, removeResult } = await revokeKitAccess(purchase, env);

        await env.DB.prepare(
          `UPDATE kit_purchases SET refund_status = 'refunded', invite_status = 'revoked',
            updated_at = datetime('now') WHERE id = ?`
        ).bind(purchase.id).run();

        await logKitEvent(env, {
          kit_purchase_id: purchase.id, sale_id: saleId, event_type: 'refund',
          github_status: removeResult?.http_status ?? null,
          event_data: {
            username: purchase.github_username,
            remove_status: removeResult?.status || 'skipped_no_username',
            invite_cancel_status: cancelResult?.status || 'skipped_no_invite_id',
          },
        });
        if (removeResult?.status === 'removed') {
          await logKitEvent(env, {
            kit_purchase_id: purchase.id, sale_id: saleId, event_type: 'collaborator_removed',
            github_status: removeResult.http_status,
            event_data: { username: purchase.github_username },
          });
        }

        await logKitRefundToSheets(env, {
          sale_id: saleId, tier: purchase.tier, amount_cents: purchase.amount_cents,
          currency: purchase.currency, test_mode: !!purchase.test_mode,
        });

        // Send refund-processed email (best-effort)
        if (purchase.email) {
          const tmpl = renderKitRefundEmail({ email: purchase.email, tier: purchase.tier });
          await sendResendEmail(env, { to: purchase.email, subject: tmpl.subject, html: tmpl.html });
        }

        console.log(`[KIT_REFUND] sale=${saleId} username=${purchase.github_username} remove=${removeResult?.status || 'n/a'}`);
        return jsonResponse({ ok: true, sale_id: saleId, refund_status: 'refunded' }, 200, origin);
      } catch (err) {
        console.error('[KIT_REFUND_ERROR] Refund webhook processing failed', err.message || err);
        return jsonResponse({ error: 'Webhook processing failed' }, 500, origin);
      }
    }

    // ──────────────────────────────────────────────
    // Gumroad webhook: dispute ping → revoke (or re-invite on dispute_won)
    // ──────────────────────────────────────────────
    // Gumroad sends two flavours of dispute event: `dispute` (a/k/a
    // `dispute_created`) opens it, `dispute_won` resolves it in our favour.
    // We branch on the `resource_name` form field (which Gumroad always sets).
    if (url.pathname === '/webhooks/gumroad/dispute' && request.method === 'POST') {
      try {
        const rawBody = await request.text();
        const form = parseFormBody(rawBody);
        const authError = gumroadAuthError(url, form, env, origin, 'KIT_DISPUTE_AUTH');
        if (authError) return authError;
        const saleId = form['sale_id'];
        const resourceName = (form['resource_name'] || '').toLowerCase();
        if (!saleId) {
          return jsonResponse({ error: 'Missing sale_id' }, 400, origin);
        }
        const purchase = await env.DB.prepare(
          'SELECT id, github_username, github_invite_id, tier, email, amount_cents, currency, test_mode, refund_status FROM kit_purchases WHERE sale_id = ?'
        ).bind(saleId).first();
        if (!purchase) {
          await logKitEvent(env, {
            kit_purchase_id: null, sale_id: saleId, event_type: 'dispute',
            event_data: { warning: 'no_matching_purchase', resource_name: resourceName },
          });
          return jsonResponse({ ok: true, skipped: true }, 200, origin);
        }

        const isDisputeWon = resourceName === 'dispute_won';

        if (isDisputeWon) {
          // Re-invite the buyer
          let inviteResult = null;
          if (purchase.github_username) {
            inviteResult = await addCollaborator(purchase.github_username, env);
          }
          const newInviteStatus =
            inviteResult?.status === 'invited' ? 'invited' :
            inviteResult?.status === 'already_active' ? 'active' :
            inviteResult?.status === 'bad_username' ? 'bad_username' :
            inviteResult?.status === 'blocked' ? 'blocked' :
            inviteResult ? 'failed' : 'pending';
          await env.DB.prepare(
            `UPDATE kit_purchases SET refund_status = 'dispute_won', invite_status = ?,
              github_invite_id = COALESCE(?, github_invite_id),
              updated_at = datetime('now') WHERE id = ?`
          ).bind(newInviteStatus, inviteResult?.invite_id ?? null, purchase.id).run();
          await logKitEvent(env, {
            kit_purchase_id: purchase.id, sale_id: saleId, event_type: 'dispute_won',
            github_status: inviteResult?.http_status ?? null,
            event_data: { username: purchase.github_username, reinvite_status: inviteResult?.status || 'skipped_no_username' },
          });
          console.log(`[KIT_DISPUTE_WON] sale=${saleId} username=${purchase.github_username} reinvite=${inviteResult?.status || 'n/a'}`);
          return jsonResponse({ ok: true, sale_id: saleId, refund_status: 'dispute_won', invite_status: newInviteStatus }, 200, origin);
        }

        // Dispute created/opened — revoke access (same as refund).
        if (purchase.refund_status === 'disputed') {
          return jsonResponse({ ok: true, already_processed: true }, 200, origin);
        }
        const { cancelResult, removeResult } = await revokeKitAccess(purchase, env);
        await env.DB.prepare(
          `UPDATE kit_purchases SET refund_status = 'disputed', invite_status = 'revoked',
            updated_at = datetime('now') WHERE id = ?`
        ).bind(purchase.id).run();
        await logKitEvent(env, {
          kit_purchase_id: purchase.id, sale_id: saleId, event_type: 'dispute',
          github_status: removeResult?.http_status ?? null,
          event_data: {
            username: purchase.github_username,
            remove_status: removeResult?.status || 'skipped_no_username',
            invite_cancel_status: cancelResult?.status || 'skipped_no_invite_id',
            resource_name: resourceName,
          },
        });
        if (removeResult?.status === 'removed') {
          await logKitEvent(env, {
            kit_purchase_id: purchase.id, sale_id: saleId, event_type: 'collaborator_removed',
            github_status: removeResult.http_status,
            event_data: { username: purchase.github_username, cause: 'dispute' },
          });
        }
        await logKitRefundToSheets(env, {
          sale_id: saleId, tier: purchase.tier, amount_cents: purchase.amount_cents,
          currency: purchase.currency, test_mode: !!purchase.test_mode,
        });
        console.log(`[KIT_DISPUTE] sale=${saleId} username=${purchase.github_username} remove=${removeResult?.status || 'n/a'}`);
        return jsonResponse({ ok: true, sale_id: saleId, refund_status: 'disputed' }, 200, origin);
      } catch (err) {
        console.error('[KIT_DISPUTE_ERROR] Dispute webhook processing failed', err.message || err);
        return jsonResponse({ error: 'Webhook processing failed' }, 500, origin);
      }
    }

    // ──────────────────────────────────────────────
    // Self-service redeem endpoint: buyer fixes typo'd GitHub username, or
    // submits one after creating their account post-purchase.
    // ──────────────────────────────────────────────
    // Auth model: requires (sale_id, email) match against an existing
    // kit_purchases row. Email is normalized (lowercase + trim) on both sides.
    // No license_key required at MVP — the sale_id+email pair is unguessable
    // enough (Gumroad sale_ids are random 22-char tokens) and keeps the
    // redemption page form simple.
    if (url.pathname === '/api/kit/redeem' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const saleId = typeof body.sale_id === 'string' ? body.sale_id.trim() : '';
        const rawUsername = typeof body.github_username === 'string' ? body.github_username : '';

        if (!email || !saleId || !rawUsername) {
          return jsonResponse({ error: 'Missing required fields: email, sale_id, github_username' }, 400, origin);
        }
        const githubUsername = normalizeGithubUsername(rawUsername);
        if (!githubUsername) {
          return jsonResponse({ error: 'invalid_username', message: 'That doesn\'t look like a valid GitHub username. Try just the username — no @, no URL.' }, 400, origin);
        }

        const purchase = await env.DB.prepare(
          'SELECT id, email, github_username, tier, invite_status, refund_status FROM kit_purchases WHERE sale_id = ?'
        ).bind(saleId).first();

        // Uniform "not found" response — don't leak whether the sale exists.
        if (!purchase || purchase.email !== email) {
          console.warn(`[KIT_REDEEM] No match for sale=${saleId} email=${email}`);
          return jsonResponse({ error: 'not_found', message: 'We couldn\'t find a purchase matching that email and order ID. Check the confirmation email from Gumroad for the exact values.' }, 404, origin);
        }

        // Refunded/disputed purchases cannot redeem — they were intentionally revoked.
        if (purchase.refund_status === 'refunded' || purchase.refund_status === 'disputed') {
          return jsonResponse({ error: 'refunded', message: 'This purchase was refunded or disputed and is no longer eligible for repo access.' }, 403, origin);
        }

        // If the username is changing and we previously invited the old one,
        // remove that collaborator first to avoid leaving stale access.
        const oldUsername = purchase.github_username;
        if (oldUsername && oldUsername !== githubUsername) {
          const oldRemove = await removeCollaborator(oldUsername, env);
          await logKitEvent(env, {
            kit_purchase_id: purchase.id, sale_id: saleId, event_type: 'collaborator_removed',
            github_status: oldRemove.http_status,
            event_data: { username: oldUsername, cause: 'username_change' },
          });
        }

        const inviteOutcome = await addCollaborator(githubUsername, env);

        let newInviteStatus;
        let httpStatusForClient = 200;
        let clientPayload;

        if (inviteOutcome.status === 'invited') {
          newInviteStatus = 'invited';
          clientPayload = {
            ok: true, invite_status: 'invited', github_username: githubUsername,
            invite_url: `https://github.com/${KIT_REPO_OWNER}/${KIT_REPO_NAME}/invitations`,
          };
        } else if (inviteOutcome.status === 'already_active') {
          newInviteStatus = 'active';
          clientPayload = {
            ok: true, invite_status: 'active', github_username: githubUsername,
            repo_url: `https://github.com/${KIT_REPO_OWNER}/${KIT_REPO_NAME}`,
          };
        } else if (inviteOutcome.status === 'bad_username') {
          newInviteStatus = 'bad_username';
          httpStatusForClient = 404;
          clientPayload = { error: 'github_user_not_found', message: `GitHub doesn't recognize "${githubUsername}". Double-check the spelling, or create the account at github.com/join first.` };
        } else if (inviteOutcome.status === 'blocked') {
          newInviteStatus = 'blocked';
          httpStatusForClient = 422;
          clientPayload = { error: 'github_blocked', message: 'GitHub blocked the invitation. Contact andreas@zurhaartools.com and we\'ll sort it manually.' };
        } else {
          newInviteStatus = 'failed';
          httpStatusForClient = 502;
          clientPayload = { error: 'github_api_error', message: 'GitHub is unavailable right now. Please try again in a few minutes.' };
        }

        await env.DB.prepare(
          `UPDATE kit_purchases SET github_username = ?, invite_status = ?,
            github_invite_id = COALESCE(?, github_invite_id),
            last_error = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(
          githubUsername,
          newInviteStatus,
          inviteOutcome.invite_id ?? null,
          inviteOutcome.detail ? String(inviteOutcome.detail).slice(0, 1000) : null,
          purchase.id
        ).run();

        await logKitEvent(env, {
          kit_purchase_id: purchase.id, sale_id: saleId, event_type: 'redeem',
          github_status: inviteOutcome.http_status,
          event_data: {
            old_username: oldUsername, new_username: githubUsername,
            invite_result: inviteOutcome.status,
          },
        });

        // Email the buyer on success so they get the invite link in their inbox.
        if (newInviteStatus === 'invited' || newInviteStatus === 'active') {
          const tmpl = renderKitPurchaseEmail({
            email, githubUsername, tier: purchase.tier, inviteOutcome,
          });
          await sendResendEmail(env, { to: email, subject: tmpl.subject, html: tmpl.html });
        }

        console.log(`[KIT_REDEEM] sale=${saleId} email=${email} old=${oldUsername} new=${githubUsername} result=${newInviteStatus}`);
        return jsonResponse(clientPayload, httpStatusForClient, origin);
      } catch (err) {
        console.error('[KIT_REDEEM_ERROR] Redeem request failed', err.message || err);
        return jsonResponse({ error: 'Internal error' }, 500, origin);
      }
    }

    // 404 for everything else
    return jsonResponse({ error: 'Not found' }, 404, origin);
  },
};
