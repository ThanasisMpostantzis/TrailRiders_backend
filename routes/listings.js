'use strict';

// MARKETPLACE: classifieds for motorcycles, cars, gear, parts and accessories.
// Free accounts can have FREE_LISTING_LIMIT active listings; Premium is unlimited and can "feature" listings
// (shown first for 7 days, MAX_FEATURED at a time).

const express = require('express');
const router = express.Router();

const { query, queryOne } = require('../config/databaseCon');
const authenticateUserToken = require('../middlewares/userAuthToken.js');
const optionalAuth = require('../middlewares/optionalAuth.js');
const { notify } = require('../utils/notify');
const { isBlockedBetween, blockedIds, isPremium } = require('../utils/social');
const { rateLimit } = require('../utils/rateLimit');

const CATEGORIES = ['Motorcycle', 'Car', 'Helmet', 'Clothing', 'Parts', 'Accessories', 'Other'];
const VEHICLES = ['Motorcycle', 'Car'];
const CONDITIONS = ['New', 'Like new', 'Used', 'For parts'];
const STATUSES = ['active', 'reserved', 'sold'];

const FREE_LISTING_LIMIT = 5;
const MAX_FEATURED = 2;
const FEATURE_DAYS = 7;
const MAX_IMAGES = 8;
const MAX_IMAGE_CHARS = 4 * 1024 * 1024; // ~3 MB per photo as base64
const MAX_PRICE = 10000000;

const toId = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
};

const serverError = (res, tag, err) => {
    console.error(`[listings/${tag}]`, err);
    res.status(500).json({ message: "Server error", type: "error" });
};

// Columns for lists: only the first photo is sent (thumbnail) to keep responses small.
const LIST_COLUMNS = `
    l.id, l.userId, l.title, l.category, l.price, l.negotiable, l.itemCondition, l.brand, l.model, l.year, l.km,
    l.location, l.status, l.featuredUntil, l.views, l.createdAt, l.updatedAt,
    JSON_UNQUOTE(JSON_EXTRACT(l.images, '$[0]')) AS thumb,
    COALESCE(JSON_LENGTH(l.images), 0) AS imagesCount,
    (l.featuredUntil IS NOT NULL AND l.featuredUntil > NOW()) AS featuredNow,
    GREATEST(TIMESTAMPDIFF(HOUR, NOW(), l.featuredUntil), 0) AS featuredHoursLeft,
    u.username AS sellerUsername, u.fullName AS sellerFullName, u.subscribed AS sellerSubscribed, u.sub_expire AS sellerSubExpire`;

const premiumFromRow = (subscribed, subExpire) =>
    !!subscribed && (!subExpire || new Date(subExpire) > new Date());

function parseImages(raw) {
    if (!raw) return [];
    try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

/** Shape a DB row for the client. `full` rows come from SELECT l.* (all photos + description). */
function formatListing(row, { favorites, full = false } = {}) {
    const images = full ? parseImages(row.images) : null;
    const out = {
        id: row.id,
        userId: row.userId,
        title: row.title,
        category: row.category,
        price: row.price === null || row.price === undefined ? null : Number(row.price),
        negotiable: !!row.negotiable,
        condition: row.itemCondition || null,
        brand: row.brand || null,
        model: row.model || null,
        year: row.year ?? null,
        km: row.km ?? null,
        location: row.location || null,
        status: row.status,
        isFeatured: !!Number(row.featuredNow),
        featuredUntil: Number(row.featuredNow) ? row.featuredUntil : null,
        featuredHoursLeft: Number(row.featuredNow) ? Number(row.featuredHoursLeft) : 0,
        views: Number(row.views) || 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        image: full ? images[0] || null : row.thumb || null,
        imagesCount: full ? images.length : Number(row.imagesCount) || 0,
        isFavorite: favorites ? favorites.has(row.id) : false,
        seller: {
            id: row.userId,
            username: row.sellerUsername || 'Deleted user',
            fullName: row.sellerFullName || null,
            isPremium: premiumFromRow(row.sellerSubscribed, row.sellerSubExpire),
        },
    };
    if (full) {
        out.images = images;
        out.description = row.description || '';
    }
    return out;
}

async function favoriteSet(userId, listingIds) {
    if (!userId || !listingIds.length) return new Set();
    const rows = await query('SELECT listingId FROM listing_favorites WHERE userId = ? AND listingId IN (?)', [userId, listingIds]);
    return new Set(rows.map((r) => r.listingId));
}

async function activeListingCount(userId, excludeId = 0) {
    const row = await queryOne(
        "SELECT COUNT(*) AS n FROM listings WHERE userId = ? AND status IN ('active', 'reserved') AND id <> ?",
        [userId, excludeId]
    );
    return Number(row.n);
}

async function checkListingLimit(userId, excludeId = 0) {
    if (await isPremium(userId)) return null;
    if ((await activeListingCount(userId, excludeId)) < FREE_LISTING_LIMIT) return null;
    return {
        message: `Free accounts can have up to ${FREE_LISTING_LIMIT} active listings. Mark one as sold or upgrade to Premium for unlimited listings.`,
        type: "error",
        code: "PREMIUM_LIMIT",
    };
}

const clean = (v, max) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s ? s.slice(0, max) : null;
};

/**
 * Validates a listing payload. Returns { error } or { data } with DB column values.
 * `base` is the existing listing (for updates): missing fields keep their current value.
 */
function validateListing(body, base = {}) {
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    const pick = (k, fallbackKey = k) => (has(k) ? body[k] : base[fallbackKey]);

    const title = clean(pick('title'), 200);
    if (!title || title.length < 3) return { error: 'Title must be at least 3 characters' };
    if (title.length > 120) return { error: 'Title is too long (max 120 characters)' };

    const description = clean(pick('description'), 5000) || '';
    if (description.length > 3000) return { error: 'Description is too long (max 3000 characters)' };

    const category = clean(pick('category'), 30);
    if (!CATEGORIES.includes(category)) return { error: `Category must be one of: ${CATEGORIES.join(', ')}` };
    const isVehicle = VEHICLES.includes(category);

    // price: null / "" = "ask for price"
    const rawPrice = pick('price');
    let price = null;
    if (rawPrice !== null && rawPrice !== undefined && String(rawPrice).trim() !== '') {
        price = Number(String(rawPrice).replace(',', '.'));
        if (!Number.isFinite(price) || price < 0) return { error: 'Price must be a positive number (or leave it empty to ask for price)' };
        if (price > MAX_PRICE) return { error: 'Price is too high' };
        price = Math.round(price * 100) / 100;
    }

    const negotiable = (has('negotiable') ? body.negotiable : base.negotiable) ? 1 : 0;

    let condition = has('condition') ? body.condition : has('itemCondition') ? body.itemCondition : base.itemCondition;
    condition = clean(condition, 20);
    if (condition && !CONDITIONS.includes(condition)) return { error: `Condition must be one of: ${CONDITIONS.join(', ')}` };

    const brand = clean(pick('brand'), 60);
    const model = clean(pick('model'), 60);

    let year = null;
    let km = null;
    if (isVehicle) {
        const rawYear = pick('year');
        if (rawYear !== null && rawYear !== undefined && String(rawYear).trim() !== '') {
            year = Number(rawYear);
            const maxYear = new Date().getFullYear() + 1;
            if (!Number.isInteger(year) || year < 1900 || year > maxYear) return { error: `Year must be between 1900 and ${maxYear}` };
        }
        const rawKm = pick('km');
        if (rawKm !== null && rawKm !== undefined && String(rawKm).trim() !== '') {
            km = Number(String(rawKm).replace(/[.,\s]/g, ''));
            if (!Number.isInteger(km) || km < 0 || km > 2000000) return { error: 'Mileage must be a whole number of km' };
        }
    }

    const location = clean(pick('location'), 120);

    let images;
    if (has('images')) {
        if (!Array.isArray(body.images)) return { error: 'Images must be a list' };
        if (body.images.length > MAX_IMAGES) return { error: `You can add up to ${MAX_IMAGES} photos` };
        for (const img of body.images) {
            if (typeof img !== 'string' || !(img.startsWith('data:image/') || /^https?:\/\//.test(img))) {
                return { error: 'One of the photos is not a valid image' };
            }
            if (img.length > MAX_IMAGE_CHARS) return { error: 'One of the photos is too large' };
        }
        images = JSON.stringify(body.images);
    } else {
        images = base.images || '[]';
    }

    return {
        data: {
            title, description, category, price, negotiable, itemCondition: condition,
            brand, model: model, year, km, location, images,
        },
    };
}

async function loadOwned(req, res) {
    const id = toId(req.params.id);
    if (!id) {
        res.status(400).json({ message: "Invalid listing", type: "error" });
        return null;
    }
    const listing = await queryOne('SELECT * FROM listings WHERE id = ?', [id]);
    if (!listing) {
        res.status(404).json({ message: "Listing not found", type: "error" });
        return null;
    }
    if (listing.userId !== req.user.id) {
        res.status(403).json({ message: "Only the seller can change this listing", type: "error" });
        return null;
    }
    return listing;
}

async function fetchFull(id, viewerId) {
    const row = await queryOne(
        `SELECT l.*, (l.featuredUntil IS NOT NULL AND l.featuredUntil > NOW()) AS featuredNow,
                GREATEST(TIMESTAMPDIFF(HOUR, NOW(), l.featuredUntil), 0) AS featuredHoursLeft,
                u.username AS sellerUsername, u.fullName AS sellerFullName, u.subscribed AS sellerSubscribed, u.sub_expire AS sellerSubExpire
         FROM listings l LEFT JOIN user u ON u.id = l.userId WHERE l.id = ?`,
        [id]
    );
    if (!row) return null;
    const favs = await favoriteSet(viewerId, [row.id]);
    return formatListing(row, { favorites: favs, full: true });
}

// ---------------- BROWSE ----------------

// GET /listings?q=&category=&minPrice=&maxPrice=&condition=&location=&sort=new|price_asc|price_desc
//              &featured=1 (only featured) &excludeFeatured=1 &sellerId= &cursor=&limit=
router.get('/', optionalAuth, async (req, res) => {
    try {
        const me = req.user ? req.user.id : null;
        const where = ["l.status IN ('active', 'reserved')"];
        const params = [];

        const q = clean(req.query.q, 100);
        if (q) {
            const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
            where.push('(l.title LIKE ? OR l.description LIKE ? OR l.brand LIKE ? OR l.model LIKE ? OR l.location LIKE ?)');
            params.push(like, like, like, like, like);
        }
        const category = clean(req.query.category, 30);
        if (category) {
            if (!CATEGORIES.includes(category)) return res.status(400).json({ message: "Unknown category", type: "error" });
            where.push('l.category = ?');
            params.push(category);
        }
        const condition = clean(req.query.condition, 20);
        if (condition) {
            const list = condition.split(',').map((c) => c.trim()).filter((c) => CONDITIONS.includes(c));
            if (list.length) {
                where.push('l.itemCondition IN (?)');
                params.push(list);
            }
        }
        const minPrice = Number(req.query.minPrice);
        if (req.query.minPrice !== undefined && req.query.minPrice !== '' && Number.isFinite(minPrice)) {
            where.push('l.price >= ?');
            params.push(minPrice);
        }
        const maxPrice = Number(req.query.maxPrice);
        if (req.query.maxPrice !== undefined && req.query.maxPrice !== '' && Number.isFinite(maxPrice)) {
            where.push('l.price <= ?');
            params.push(maxPrice);
        }
        const location = clean(req.query.location, 120);
        if (location) {
            where.push('l.location LIKE ?');
            params.push(`%${location.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
        }
        const sellerId = toId(req.query.sellerId);
        if (sellerId) {
            where.push('l.userId = ?');
            params.push(sellerId);
        }
        if (req.query.featured === '1') where.push('l.featuredUntil > NOW()');
        if (req.query.excludeFeatured === '1') where.push('(l.featuredUntil IS NULL OR l.featuredUntil <= NOW())');

        if (me) {
            const hidden = await blockedIds(me);
            if (hidden.length) {
                where.push('l.userId NOT IN (?)');
                params.push(hidden);
            }
        }

        const sort = ['new', 'price_asc', 'price_desc'].includes(req.query.sort) ? req.query.sort : 'new';
        const order = {
            new: 'l.createdAt DESC, l.id DESC',
            price_asc: 'l.price IS NULL, l.price ASC, l.id DESC',
            price_desc: 'l.price IS NULL, l.price DESC, l.id DESC',
        }[sort];

        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
        const offset = Math.max(parseInt(req.query.cursor, 10) || 0, 0);
        const whereSql = where.join(' AND ');

        const rows = await query(
            `SELECT ${LIST_COLUMNS}
             FROM listings l JOIN user u ON u.id = l.userId
             WHERE ${whereSql}
             ORDER BY featuredNow DESC, ${order}
             LIMIT ? OFFSET ?`,
            [...params, limit + 1, offset]
        );
        const countRow = await queryOne(
            `SELECT COUNT(*) AS n FROM listings l JOIN user u ON u.id = l.userId WHERE ${whereSql}`,
            params
        );

        const page = rows.slice(0, limit);
        const favs = await favoriteSet(me, page.map((r) => r.id));
        res.json({
            items: page.map((r) => formatListing(r, { favorites: favs })),
            nextCursor: rows.length > limit ? String(offset + limit) : null,
            total: Number(countRow.n),
        });
    } catch (err) {
        serverError(res, 'list', err);
    }
});

// My listings (all statuses) + how many favorites each one has
router.get('/mine', authenticateUserToken, async (req, res) => {
    try {
        const rows = await query(
            `SELECT ${LIST_COLUMNS}, (SELECT COUNT(*) FROM listing_favorites f WHERE f.listingId = l.id) AS favoritesCount
             FROM listings l JOIN user u ON u.id = l.userId
             WHERE l.userId = ?
             ORDER BY FIELD(l.status, 'active', 'reserved', 'sold'), l.createdAt DESC, l.id DESC`,
            [req.user.id]
        );
        const favs = await favoriteSet(req.user.id, rows.map((r) => r.id));
        const premium = await isPremium(req.user.id);
        const active = rows.filter((r) => r.status !== 'sold').length;
        const featured = rows.filter((r) => Number(r.featuredNow) && r.status !== 'sold').length;
        res.json({
            items: rows.map((r) => ({ ...formatListing(r, { favorites: favs }), favoritesCount: Number(r.favoritesCount) })),
            limits: {
                isPremium: premium,
                active,
                maxActive: premium ? null : FREE_LISTING_LIMIT,
                featured,
                maxFeatured: MAX_FEATURED,
                featureDays: FEATURE_DAYS,
            },
        });
    } catch (err) {
        serverError(res, 'mine', err);
    }
});

// Listings I saved (newest saved first)
router.get('/favorites', authenticateUserToken, async (req, res) => {
    try {
        const hidden = await blockedIds(req.user.id);
        const rows = await query(
            `SELECT ${LIST_COLUMNS}
             FROM listing_favorites f
             JOIN listings l ON l.id = f.listingId
             JOIN user u ON u.id = l.userId
             WHERE f.userId = ? ${hidden.length ? 'AND l.userId NOT IN (?)' : ''}
             ORDER BY f.createdAt DESC, l.id DESC`,
            hidden.length ? [req.user.id, hidden] : [req.user.id]
        );
        const favs = new Set(rows.map((r) => r.id));
        res.json({ items: rows.map((r) => formatListing(r, { favorites: favs })) });
    } catch (err) {
        serverError(res, 'favorites', err);
    }
});

// One listing with all photos, the seller card and more listings from the same seller
router.get('/:id', optionalAuth, async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid listing", type: "error" });
    try {
        const me = req.user ? req.user.id : null;
        const base = await queryOne('SELECT id, userId FROM listings WHERE id = ?', [id]);
        if (!base) return res.status(404).json({ message: "Listing not found", type: "error" });
        if (me && base.userId !== me && (await isBlockedBetween(me, base.userId))) {
            return res.status(404).json({ message: "Listing not found", type: "error" });
        }

        const isOwner = me === base.userId;
        if (!isOwner) await query('UPDATE listings SET views = views + 1 WHERE id = ?', [id]);

        const listing = await fetchFull(id, me);
        const seller = await queryOne(
            'SELECT id, username, fullName, image, bike, location, subscribed, sub_expire, termsAcceptedAt FROM user WHERE id = ?',
            [base.userId]
        );
        const counts = await queryOne(
            `SELECT
                (SELECT COUNT(*) FROM listings WHERE userId = ? AND status IN ('active', 'reserved')) AS active,
                (SELECT COUNT(*) FROM listings WHERE userId = ? AND status = 'sold') AS sold,
                (SELECT COUNT(*) FROM listing_favorites WHERE listingId = ?) AS favorites`,
            [base.userId, base.userId, id]
        );
        const more = await query(
            `SELECT ${LIST_COLUMNS}
             FROM listings l JOIN user u ON u.id = l.userId
             WHERE l.userId = ? AND l.id <> ? AND l.status IN ('active', 'reserved')
             ORDER BY featuredNow DESC, l.createdAt DESC LIMIT 6`,
            [base.userId, id]
        );
        const moreFavs = await favoriteSet(me, more.map((r) => r.id));

        res.json({
            ...listing,
            isOwner,
            favoritesCount: Number(counts.favorites),
            seller: seller
                ? {
                    id: seller.id,
                    username: seller.username,
                    fullName: seller.fullName || null,
                    image: seller.image || null,
                    bike: seller.bike || null,
                    location: seller.location || null,
                    isPremium: premiumFromRow(seller.subscribed, seller.sub_expire),
                    memberSince: seller.termsAcceptedAt || null,
                    activeListings: Number(counts.active),
                    soldListings: Number(counts.sold),
                }
                : { id: base.userId, username: 'Deleted user', fullName: null, image: null, isPremium: false, memberSince: null, activeListings: 0, soldListings: 0 },
            moreFromSeller: more.map((r) => formatListing(r, { favorites: moreFavs })),
        });
    } catch (err) {
        serverError(res, 'get', err);
    }
});

// ---------------- CREATE / EDIT ----------------

router.post('/', authenticateUserToken, rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: 'You are posting listings too fast. Please wait a few minutes.' }), async (req, res) => {
    try {
        const { error, data } = validateListing(req.body || {});
        if (error) return res.status(400).json({ message: error, type: "error" });

        const limit = await checkListingLimit(req.user.id);
        if (limit) return res.status(403).json(limit);

        const result = await query(
            `INSERT INTO listings (userId, title, description, category, price, negotiable, itemCondition, brand, model, year, km, location, images)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, data.title, data.description, data.category, data.price, data.negotiable, data.itemCondition,
                data.brand, data.model, data.year, data.km, data.location, data.images]
        );
        const listing = await fetchFull(result.insertId, req.user.id);
        res.status(201).json({ type: "success", message: "Listing published", listingId: result.insertId, listing });
    } catch (err) {
        serverError(res, 'create', err);
    }
});

router.put('/:id', authenticateUserToken, async (req, res) => {
    try {
        const listing = await loadOwned(req, res);
        if (!listing) return;
        const { error, data } = validateListing(req.body || {}, listing);
        if (error) return res.status(400).json({ message: error, type: "error" });

        await query(
            `UPDATE listings SET title = ?, description = ?, category = ?, price = ?, negotiable = ?, itemCondition = ?,
                brand = ?, model = ?, year = ?, km = ?, location = ?, images = ?, updatedAt = NOW()
             WHERE id = ?`,
            [data.title, data.description, data.category, data.price, data.negotiable, data.itemCondition,
                data.brand, data.model, data.year, data.km, data.location, data.images, listing.id]
        );

        // Price drop -> tell the people who saved it
        const oldPrice = listing.price === null ? null : Number(listing.price);
        if (oldPrice !== null && data.price !== null && data.price < oldPrice && listing.status !== 'sold') {
            const favs = await query('SELECT userId FROM listing_favorites WHERE listingId = ?', [listing.id]);
            if (favs.length) {
                await notify(favs.map((f) => f.userId), {
                    senderId: req.user.id,
                    senderName: req.user.username,
                    subject: 'Price drop',
                    description: `"${data.title}" is now €${data.price.toLocaleString('en-US')} (was €${oldPrice.toLocaleString('en-US')}).`,
                    link: `/market/${listing.id}`,
                });
            }
        }

        res.json({ type: "success", message: "Listing updated", listing: await fetchFull(listing.id, req.user.id) });
    } catch (err) {
        serverError(res, 'update', err);
    }
});

router.patch('/:id/status', authenticateUserToken, async (req, res) => {
    try {
        const status = String((req.body || {}).status || '');
        if (!STATUSES.includes(status)) return res.status(400).json({ message: `Status must be one of: ${STATUSES.join(', ')}`, type: "error" });
        const listing = await loadOwned(req, res);
        if (!listing) return;

        // Re-activating a sold listing counts towards the free limit again
        if (listing.status === 'sold' && status !== 'sold') {
            const limit = await checkListingLimit(req.user.id, listing.id);
            if (limit) return res.status(403).json(limit);
        }

        // A sold listing frees its featured slot
        await query(
            `UPDATE listings SET status = ?, ${status === 'sold' ? 'featuredUntil = NULL,' : ''} updatedAt = NOW() WHERE id = ?`,
            [status, listing.id]
        );
        res.json({ type: "success", status, listing: await fetchFull(listing.id, req.user.id) });
    } catch (err) {
        serverError(res, 'status', err);
    }
});

router.delete('/:id', authenticateUserToken, async (req, res) => {
    try {
        const listing = await loadOwned(req, res);
        if (!listing) return;
        await query('DELETE FROM listing_favorites WHERE listingId = ?', [listing.id]);
        await query('DELETE FROM listings WHERE id = ?', [listing.id]);
        res.json({ type: "success", message: "Listing deleted" });
    } catch (err) {
        serverError(res, 'delete', err);
    }
});

// ---------------- FEATURE (Premium) ----------------

router.post('/:id/feature', authenticateUserToken, async (req, res) => {
    try {
        const listing = await loadOwned(req, res);
        if (!listing) return;
        if (!(await isPremium(req.user.id))) {
            return res.status(403).json({
                message: "Featuring listings is a Premium feature. Upgrade to show your listing at the top of the Marketplace.",
                type: "error",
                code: "PREMIUM_REQUIRED",
            });
        }
        if (listing.status === 'sold') return res.status(400).json({ message: "Sold listings can't be featured", type: "error" });

        const others = await queryOne(
            "SELECT COUNT(*) AS n FROM listings WHERE userId = ? AND id <> ? AND status <> 'sold' AND featuredUntil > NOW()",
            [req.user.id, listing.id]
        );
        if (Number(others.n) >= MAX_FEATURED) {
            return res.status(403).json({
                message: `You can feature up to ${MAX_FEATURED} listings at a time. Remove the feature from another listing first.`,
                type: "error",
                code: "FEATURE_LIMIT",
            });
        }

        await query(`UPDATE listings SET featuredUntil = DATE_ADD(NOW(), INTERVAL ${FEATURE_DAYS} DAY) WHERE id = ?`, [listing.id]);
        res.json({
            type: "success",
            message: `Your listing is featured for ${FEATURE_DAYS} days`,
            listing: await fetchFull(listing.id, req.user.id),
        });
    } catch (err) {
        serverError(res, 'feature', err);
    }
});

router.delete('/:id/feature', authenticateUserToken, async (req, res) => {
    try {
        const listing = await loadOwned(req, res);
        if (!listing) return;
        await query('UPDATE listings SET featuredUntil = NULL WHERE id = ?', [listing.id]);
        res.json({ type: "success", listing: await fetchFull(listing.id, req.user.id) });
    } catch (err) {
        serverError(res, 'unfeature', err);
    }
});

// ---------------- FAVORITES ----------------

router.post('/:id/favorite', authenticateUserToken, async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid listing", type: "error" });
    try {
        const listing = await queryOne('SELECT id, userId, title FROM listings WHERE id = ?', [id]);
        if (!listing) return res.status(404).json({ message: "Listing not found", type: "error" });
        if (listing.userId === req.user.id) return res.status(400).json({ message: "You can't save your own listing", type: "error" });
        if (await isBlockedBetween(req.user.id, listing.userId)) return res.status(403).json({ message: "You can't save this listing", type: "error" });

        const result = await query('INSERT IGNORE INTO listing_favorites (listingId, userId) VALUES (?, ?)', [id, req.user.id]);
        if (result.affectedRows) {
            // At most one "saved" notification per user and listing (even after un-saving and saving again)
            const link = `/market/${id}`;
            const already = await queryOne(
                "SELECT id FROM notifications WHERE userId = ? AND senderId = ? AND link = ? AND subject = 'Listing saved' LIMIT 1",
                [listing.userId, req.user.id, link]
            );
            if (!already) {
                await notify(listing.userId, {
                    senderId: req.user.id,
                    senderName: req.user.username,
                    subject: 'Listing saved',
                    description: `${req.user.username} saved your listing "${listing.title}".`,
                    link,
                });
            }
        }
        res.json({ type: "success", isFavorite: true });
    } catch (err) {
        serverError(res, 'favorite', err);
    }
});

router.delete('/:id/favorite', authenticateUserToken, async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid listing", type: "error" });
    try {
        await query('DELETE FROM listing_favorites WHERE listingId = ? AND userId = ?', [id, req.user.id]);
        res.json({ type: "success", isFavorite: false });
    } catch (err) {
        serverError(res, 'unfavorite', err);
    }
});

module.exports = router;
module.exports.LISTING_CATEGORIES = CATEGORIES;
module.exports.LISTING_CONDITIONS = CONDITIONS;
module.exports.FREE_LISTING_LIMIT = FREE_LISTING_LIMIT;
