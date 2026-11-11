'use strict';

// Geo maths for GPS recordings (tracks) and the route library.
// A recorded point is a compact array: [lat, lng, tMs, speedKmh, altitude, seg?]
//   tMs      = milliseconds since the recording started
//   speedKmh = GPS speed (null if unknown)
//   altitude = metres above sea level (null if unknown)
//   seg      = 1 when this point starts a new segment (first point after a pause) — the gap is not counted

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

const MAX_POINTS = 20000;
const MOVING_KMH = 3;
const MAX_PLAUSIBLE_KMH = 350;

function haversine(aLat, aLng, bLat, bLng) {
    const dLat = rad(bLat - aLat);
    const dLng = rad(bLng - aLng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round = (v, d) => {
    const f = 10 ** d;
    return Math.round(v * f) / f;
};

/**
 * Validates + normalises a list of recorded points.
 * Returns { points } or { error }.
 */
function cleanTrackPoints(raw) {
    if (!Array.isArray(raw)) return { error: 'Points must be a list' };
    if (raw.length < 2) return { error: 'The recording is too short (need at least 2 GPS points)' };
    if (raw.length > MAX_POINTS) return { error: `The recording is too long (max ${MAX_POINTS} points)` };

    const out = [];
    let lastT = -1;
    for (const p of raw) {
        if (!Array.isArray(p) || p.length < 2) return { error: 'Invalid GPS point' };
        const lat = num(p[0]);
        const lng = num(p[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            return { error: 'Invalid GPS coordinates' };
        }
        let t = num(p[2]);
        if (!Number.isFinite(t) || t < 0) t = lastT < 0 ? 0 : lastT;
        if (t < lastT) t = lastT; // never go back in time
        if (t > 8 * 86400 * 1000) return { error: 'Invalid point time' };
        lastT = t;

        let speed = num(p[3]);
        speed = Number.isFinite(speed) && speed >= 0 && speed <= 500 ? round(speed, 1) : null;
        let alt = num(p[4]);
        alt = Number.isFinite(alt) && alt > -500 && alt < 9000 ? round(alt, 1) : null;
        const seg = out.length > 0 && Number(p[5]) === 1 ? 1 : 0;

        const point = [round(lat, 6), round(lng, 6), Math.round(t), speed, alt];
        if (seg) point.push(1);
        out.push(point);
    }
    return { points: out };
}

/** Distance, times, speeds and elevation computed from points (single source of truth) */
function computeStats(points) {
    let distanceM = 0;
    let activeMs = 0;
    let movingMs = 0;
    let maxSpeedKmh = 0;
    let gain = 0;
    let maxAlt = null;
    let minAlt = null;
    let altRef = null;

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const alt = p[4];
        if (alt !== null && alt !== undefined) {
            maxAlt = maxAlt === null ? alt : Math.max(maxAlt, alt);
            minAlt = minAlt === null ? alt : Math.min(minAlt, alt);
            // hysteresis so GPS altitude noise doesn't inflate the climb
            if (altRef === null) altRef = alt;
            else if (alt - altRef >= 3) {
                gain += alt - altRef;
                altRef = alt;
            } else if (alt < altRef - 3) altRef = alt;
        }

        // GPS speed: median of 3 neighbours removes single spikes
        if (p[3] !== null && p[3] !== undefined) {
            const win = [points[i - 1], p, points[i + 1]].filter((x) => x && x[3] !== null && x[3] !== undefined).map((x) => x[3]);
            win.sort((a, b) => a - b);
            const med = win[Math.floor(win.length / 2)];
            if (win.length >= 2 && med <= MAX_PLAUSIBLE_KMH) maxSpeedKmh = Math.max(maxSpeedKmh, med);
        }

        if (i === 0 || p[5] === 1) continue; // segment start: no distance from the previous point
        const q = points[i - 1];
        const d = haversine(q[0], q[1], p[0], p[1]);
        const dt = Math.max(0, p[2] - q[2]);
        distanceM += d;
        activeMs += dt;
        // average speed between the two fixes decides if this interval counts as "moving"
        const segKmh = dt > 0 ? (d / (dt / 1000)) * 3.6 : 0;
        if (dt > 0 && segKmh > MOVING_KMH) movingMs += dt;
        // without GPS speed, fall back to segment speed for intervals long enough to be reliable
        const hasGps = p[3] !== null && p[3] !== undefined;
        if (!hasGps && dt >= 2000 && segKmh <= MAX_PLAUSIBLE_KMH) maxSpeedKmh = Math.max(maxSpeedKmh, segKmh);
    }

    const movingSec = Math.round(movingMs / 1000);
    return {
        distanceM: round(distanceM, 1),
        activeSec: Math.round(activeMs / 1000),
        movingSec,
        maxSpeedKmh: round(maxSpeedKmh, 1),
        avgSpeedKmh: movingSec > 0 ? round((distanceM / movingSec) * 3.6, 1) : 0,
        elevationGainM: maxAlt === null ? null : Math.round(gain),
        maxAltitudeM: maxAlt === null ? null : Math.round(maxAlt),
        minAltitudeM: minAlt === null ? null : Math.round(minAlt),
    };
}

/** Uniformly thins a list to at most `max` items (keeps first & last) */
function thin(points, max) {
    if (points.length <= max) return points;
    const step = (points.length - 1) / (max - 1);
    return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

/** Douglas–Peucker simplification on [lat, lng, ...] arrays (tolerance in metres), then capped */
function simplifyPath(points, toleranceM = 8, max = 2000) {
    if (points.length <= 2) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    // local equirectangular projection (metres)
    const lat0 = rad(points[0][0]);
    const xy = points.map((p) => [rad(p[1]) * Math.cos(lat0) * R, rad(p[0]) * R]);
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const [ax, ay] = xy[a];
        const [bx, by] = xy[b];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let maxD = 0;
        let idx = -1;
        for (let i = a + 1; i < b; i++) {
            const [px, py] = xy[i];
            let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
            t = Math.max(0, Math.min(1, t));
            const ex = ax + t * dx - px;
            const ey = ay + t * dy - py;
            const d = ex * ex + ey * ey;
            if (d > maxD) {
                maxD = d;
                idx = i;
            }
        }
        if (idx > 0 && Math.sqrt(maxD) > toleranceM) {
            keep[idx] = 1;
            stack.push([a, idx], [idx, b]);
        }
    }
    return thin(points.filter((_, i) => keep[i]), max);
}

/**
 * Validates route-library points: accepts [lat, lng, alt?] or full track points.
 * Returns { points: [[lat, lng, alt|null], ...] } (simplified, max 2000) or { error }.
 */
function cleanRoutePoints(raw) {
    if (!Array.isArray(raw)) return { error: 'Route points are required' };
    if (raw.length < 2) return { error: 'A route needs at least 2 points' };
    if (raw.length > MAX_POINTS) return { error: `Too many points (max ${MAX_POINTS})` };
    const out = [];
    for (const p of raw) {
        const lat = Array.isArray(p) ? num(p[0]) : p && num(p.latitude);
        const lng = Array.isArray(p) ? num(p[1]) : p && num(p.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            return { error: 'Invalid route coordinates' };
        }
        let alt = Array.isArray(p) ? num(p.length >= 5 ? p[4] : p[2]) : p && num(p.altitude);
        alt = Number.isFinite(alt) && alt > -500 && alt < 9000 ? Math.round(alt) : null;
        out.push([round(lat, 6), round(lng, 6), alt]);
    }
    return { points: simplifyPath(out) };
}

/** Length + climb of a route path ([lat, lng, alt]) */
function routeStats(points) {
    let distanceM = 0;
    let gain = 0;
    let ref = null;
    for (let i = 0; i < points.length; i++) {
        if (i) distanceM += haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
        const a = points[i][2];
        if (a === null || a === undefined) continue;
        if (ref === null) ref = a;
        else if (a - ref >= 3) {
            gain += a - ref;
            ref = a;
        } else if (a < ref - 3) ref = a;
    }
    return { distanceM: round(distanceM, 1), elevationGainM: points.some((p) => p[2] !== null) ? Math.round(gain) : null };
}

const parsePoints = (text) => {
    if (!text) return [];
    try {
        const v = JSON.parse(text);
        return Array.isArray(v) ? v : [];
    } catch {
        return [];
    }
};

module.exports = {
    MAX_POINTS,
    haversine,
    cleanTrackPoints,
    computeStats,
    cleanRoutePoints,
    routeStats,
    simplifyPath,
    thin,
    parsePoints,
};
