'use strict';

// One-off: fill missing start/finish coordinates of existing rides with OpenStreetMap Nominatim.
// Usage (from the backend folder):  node scripts/geocodeRides.js
// Respects Nominatim's limit of 1 request/second, so it can take a while for many rides.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { pool, query } = require('../config/databaseCon');
const { geocode } = require('../utils/geocode');

async function main() {
    const rides = await query(
        `SELECT id, startLocation, finishLocation, startLat, endLat FROM rides
         WHERE (startLat IS NULL AND startLocation IS NOT NULL AND startLocation <> '')
            OR (endLat IS NULL AND finishLocation IS NOT NULL AND finishLocation <> '')
         ORDER BY id`
    );
    console.log(`${rides.length} ride(s) with missing coordinates`);

    const stats = { start: 0, finish: 0, notFound: [] };
    for (const r of rides) {
        if (r.startLat === null && r.startLocation) {
            const p = await geocode(r.startLocation);
            if (p) {
                await query('UPDATE rides SET startLat = ?, startLng = ? WHERE id = ? AND startLat IS NULL', [p.lat, p.lng, r.id]);
                stats.start++;
            } else stats.notFound.push(`#${r.id} start "${r.startLocation}"`);
            console.log(`#${r.id} start  "${r.startLocation}" -> ${p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : 'not found'}`);
        }
        if (r.endLat === null && r.finishLocation) {
            const p = await geocode(r.finishLocation);
            if (p) {
                await query('UPDATE rides SET endLat = ?, endLng = ? WHERE id = ? AND endLat IS NULL', [p.lat, p.lng, r.id]);
                stats.finish++;
            } else stats.notFound.push(`#${r.id} finish "${r.finishLocation}"`);
            console.log(`#${r.id} finish "${r.finishLocation}" -> ${p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : 'not found'}`);
        }
    }

    console.log(`\nDone. Start points filled: ${stats.start}, finish points filled: ${stats.finish}, not found: ${stats.notFound.length}`);
    if (stats.notFound.length) console.log('Not found:\n  ' + stats.notFound.join('\n  '));
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
