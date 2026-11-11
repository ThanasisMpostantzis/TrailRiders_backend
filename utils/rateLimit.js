'use strict';

// Small in-memory rate limiter (no extra dependency). Good enough for one server instance.
// Usage: router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), login)

function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, message = 'Too many attempts. Please try again in a few minutes.' } = {}) {
    const hits = new Map(); // key -> { count, resetAt }

    setInterval(() => {
        const now = Date.now();
        for (const [key, v] of hits) if (v.resetAt <= now) hits.delete(key);
    }, windowMs).unref();

    return (req, res, next) => {
        const key = `${req.ip}|${req.baseUrl}${req.path}`;
        const now = Date.now();
        const entry = hits.get(key);

        if (!entry || entry.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }
        entry.count += 1;
        if (entry.count > max) {
            res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
            return res.status(429).json({ message, type: "error" });
        }
        next();
    };
}

module.exports = { rateLimit };
