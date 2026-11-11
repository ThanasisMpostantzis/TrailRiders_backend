'use strict';

// Place name -> coordinates with OpenStreetMap Nominatim (free, no API key).
// Nominatim usage policy: max 1 request/second, a real User-Agent, cache results.
// https://operations.osmfoundation.org/policies/nominatim/

const { query } = require('../config/databaseCon');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'TrailRiders/1.0 (dev)';
const MIN_INTERVAL_MS = 1100; // a little over 1 s between requests
const CACHE_MAX = 2000;

const cache = new Map(); // normalised place -> { lat, lng } | null (null = not found)
const inflight = new Map(); // normalised place -> Promise
let chain = Promise.resolve();
let lastRequestAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalise = (place) => String(place || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Prefer towns/villages/landmarks; roads named "A - B - C" after the towns they connect are a classic false match.
const MAJOR_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link']);
function score(hit) {
    let s = Number(hit.importance) || 0;
    if (hit.class === 'place' || hit.class === 'boundary') s += 0.15;
    if (hit.class === 'highway' && MAJOR_ROADS.has(hit.type)) s -= 0.5;
    return s;
}

async function request(place) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    // limit=5 + pick the best hit (see score()): with limit=1 Nominatim sometimes returns a street or a motorway
    // named after the town (e.g. "Πτολεμαιδα" -> a street in Rhodope instead of the city in Kozani).
    const url = `${NOMINATIM_URL}?format=json&limit=5&countrycodes=gr&q=${encodeURIComponent(place)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
        const data = await res.json();
        const hits = Array.isArray(data) ? data : [];
        const hit = hits.reduce((best, h) => (!best || score(h) > score(best) ? h : best), null);
        if (!hit) return null;
        const lat = Number(hit.lat);
        const lng = Number(hit.lon);
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Geocode a place name in Greece. Resolves to { lat, lng } or null. Never rejects.
 * Requests are queued (1/second) and results are cached in memory.
 */
function geocode(place) {
    const key = normalise(place);
    if (!key) return Promise.resolve(null);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (inflight.has(key)) return inflight.get(key);

    const job = chain.then(async () => {
        if (cache.has(key)) return cache.get(key);
        try {
            const result = await request(String(place).trim());
            if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
            cache.set(key, result);
            return result;
        } catch (err) {
            console.error('[geocode]', place, err.message);
            return null; // network errors are not cached, so a later save can retry
        }
    });
    chain = job.catch(() => null);
    inflight.set(key, job);
    job.finally(() => inflight.delete(key));
    return job;
}

/**
 * Fill rides.startLat/startLng and/or endLat/endLng in the background.
 * Only writes if the ride's place name is still the same (it may have been edited meanwhile).
 * @param {number} rideId
 * @param {{ start?: string|null, finish?: string|null }} places which ends to geocode
 */
function geocodeRideLater(rideId, { start, finish } = {}) {
    (async () => {
        if (start) {
            const p = await geocode(start);
            if (p) {
                await query(
                    'UPDATE rides SET startLat = ?, startLng = ? WHERE id = ? AND startLocation = ? AND startLat IS NULL',
                    [p.lat, p.lng, rideId, start]
                );
            }
        }
        if (finish) {
            const p = await geocode(finish);
            if (p) {
                await query(
                    'UPDATE rides SET endLat = ?, endLng = ? WHERE id = ? AND finishLocation = ? AND endLat IS NULL',
                    [p.lat, p.lng, rideId, finish]
                );
            }
        }
    })().catch((err) => console.error('[geocodeRide]', rideId, err.message));
}

module.exports = { geocode, geocodeRideLater };
