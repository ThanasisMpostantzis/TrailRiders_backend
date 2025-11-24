const mysql = require('mysql');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB,
    dateStrings: true,
    charset: 'utf8mb4',
    timezone: 'utc',
    multipleStatements: true,
    timeout: 5000
});

function runQuery(query, callback) {
    pool.query(query, (err, rows) => {
        if (err) throw err;

        return callback(rows[0]) // Returns actual data ONLY if query involves SELECTing data from database
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

module.exports = { pool, runQuery };