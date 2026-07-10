import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Deliberately not wrangler.toml-based: the unsafe ratelimit binding isn't
// supported by the test pool, and tests must never see production bindings.
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.js',
      miniflare: {
        compatibilityDate: '2025-01-01',
        d1Databases: ['DB'],
        bindings: {
          STRIPE_SECRET_KEY: 'sk_live_dummy',
          STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
          ANTHROPIC_API_KEY: 'sk-ant-dummy',
          RESEND_API_KEY: 're_dummy',
          GOOGLE_SHEETS_URL: 'https://sheets.invalid/exec',
          GOOGLE_SHEETS_API_KEY: 'sheets-dummy-key',
          ADMIN_API_KEY: 'admin-dummy-key',
          GUMROAD_PING_TOKEN: 'gumroad-dummy-token',
          GITHUB_KIT_PAT: 'ghp_dummy',
          ALLOWED_ORIGINS: 'https://zurhaartools.com',
        },
      },
    }),
  ],
});
