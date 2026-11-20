require('dotenv').config();

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() !== 'false' && String(value) !== '0';
}

const authMode = String(process.env.AUTH_MODE || 'facebook').toLowerCase() === 'instagram'
  ? 'instagram'
  : 'facebook';

const defaultFacebookScopes =
  'instagram_basic,instagram_manage_comments,instagram_manage_messages,pages_show_list,pages_manage_metadata,pages_read_engagement,pages_messaging,business_management';
const defaultInstagramScopes =
  'instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages';

const scopesEnv = authMode === 'instagram'
  ? (process.env.INSTAGRAM_SCOPES || defaultInstagramScopes)
  : (process.env.FACEBOOK_SCOPES || process.env.INSTAGRAM_SCOPES || defaultFacebookScopes);

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  mockMode: bool(process.env.MOCK_MODE, true),
  authMode,
  appUrl: String(process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-change-me',
  sessionTtlDays: 30,
  dbPath: process.env.DB_PATH || './data/rona-insta.db',
  meta: {
    appId: process.env.META_APP_ID || process.env.INSTAGRAM_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || '',
    configId: process.env.META_CONFIG_ID || '',
    verifyToken: process.env.WEBHOOK_VERIFY_TOKEN || 'rona-insta-verify',
    apiVersion: process.env.GRAPH_API_VERSION || 'v23.0',
    scopes: String(scopesEnv).split(',').map((s) => s.trim()).filter(Boolean),
  },
  followCheckMode: process.env.FOLLOW_CHECK_MODE || 'stub',
  pollIntervalMs: parseInt(process.env.MEDIA_POLL_INTERVAL_MS || '120000', 10),
  followupIntervalMs: parseInt(process.env.FOLLOWUP_INTERVAL_MS || '60000', 10),
  commentPollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '60000', 10),
};

module.exports = config;
