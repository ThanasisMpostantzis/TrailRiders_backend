'use strict';

// mysql2 supports promises and prepared statements (`?` placeholders).
const mysql = require('mysql2');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB,
    dateStrings: true,
    charset: 'utf8mb4',
    timezone: 'Z',
    connectTimeout: 5000,
    waitForConnections: true,
    connectionLimit: 10
});

const promisePool = pool.promise();

/**
 * Run a parameterised query and return all rows (or the result packet for writes).
 * Always pass user input through `params` — never build SQL with template strings.
 */
async function query(sql, params = []) {
    const [rows] = await promisePool.query(sql, params);
    return rows;
}

/** Same as query() but returns only the first row (or null). */
async function queryOne(sql, params = []) {
    const rows = await query(sql, params);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Legacy callback helper kept for older controllers.
 * runQuery(sql, callback) or runQuery(sql, params, callback). Callback receives the first row.
 */
function runQuery(sql, params, callback) {
    if (typeof params === 'function') {
        callback = params;
        params = [];
    }
    pool.query(sql, params, (err, rows) => {
        if (err) return console.log(err);
        return callback(Array.isArray(rows) ? rows[0] : rows);
    });
}

// Check connection
pool.getConnection((err, connection) => {
    if (err) {
        console.error('Database connection failed: ', err.message);
    } else {
        console.log('Connected to Database successfully!');
        connection.release();
    }
});

module.exports = { pool, query, queryOne, runQuery };
