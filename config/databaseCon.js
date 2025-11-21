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

module.exports = pool;