import { createHmac, randomBytes } from 'node:crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const privateLimiterSecret = randomBytes(32);
export const privateNetworkKey = (req) =>
  createHmac('sha256', privateLimiterSecret).update(ipKeyGenerator(req.ip)).digest('hex');

// These counters are per process, not a billing cap. Keep generous network
// headroom for a full lobby on one Wi-Fi connection (20 polls/min per player).
export function createRequestLimits({
  networkLimit = 3000,
  totalLimit = 6000,
  playerLimit = 500,
  liveLimit = 45,
} = {}) {
  const secret = randomBytes(32);
  const message = { error: 'Too many requests. Please try again in a minute.' };
  const common = { windowMs: 60_000, standardHeaders: 'draft-8', legacyHeaders: false, message };
  const network = rateLimit({
    ...common,
    limit: networkLimit,
    keyGenerator: (req) =>
      createHmac('sha256', secret).update(ipKeyGenerator(req.ip)).digest('hex'),
  });
  const total = rateLimit({
    ...common,
    limit: totalLimit,
    keyGenerator: () => 'all',
    standardHeaders: false,
  });
  const player = rateLimit({
    ...common,
    windowMs: 15 * 60_000,
    limit: playerLimit,
    message: { error: 'Too many requests. Please try again in 15 minutes.' },
    keyGenerator: (req) => req.playerId,
  });
  const live = rateLimit({ ...common, limit: liveLimit, keyGenerator: (req) => req.playerId });
  const drafts = rateLimit({ ...common, limit: 120, keyGenerator: (req) => req.playerId });
  // Run on /api before app.param('gameId'), so rejected polls never read Firestore.
  const gameplay = (req, res, next) =>
    req.method === 'POST' && /\/live\/[^/]+\/draft$/.test(req.path)
      ? drafts(req, res, next)
      : /^\/(?:games|publications)\/[^/]+\/live\/[^/]+(?:\/[^/]+)?$/.test(req.path) &&
          !req.path.endsWith('/photos')
        ? live(req, res, next)
        : player(req, res, next);
  return { early: [total, network], gameplay };
}
