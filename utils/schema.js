'use strict';

const { query, queryOne } = require('../config/databaseCon');

// Tables / columns the app needs that are missing from the live database.
// Everything here is additive and safe to run on every startup (MySQL 8 and MariaDB).
// The same SQL lives in SQL/migrations.sql for manual setup.

const TABLES = [
    `CREATE TABLE IF NOT EXISTS notifications (
        id INT NOT NULL AUTO_INCREMENT,
        userId INT NOT NULL,
        senderId INT DEFAULT NULL,
        senderName VARCHAR(100) DEFAULT NULL,
        subject VARCHAR(150) NOT NULL,
        description TEXT,
        rideId BIGINT DEFAULT NULL,
        link VARCHAR(150) DEFAULT NULL,
        isRead TINYINT(1) NOT NULL DEFAULT 0,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_notifications_user (userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    `CREATE TABLE IF NOT EXISTS ride_comments (
        id INT NOT NULL AUTO_INCREMENT,
        rideId BIGINT NOT NULL,
        userId INT NOT NULL,
        text VARCHAR(1000) NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_comments_ride (rideId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    `CREATE TABLE IF NOT EXISTS ride_ratings (
        id INT NOT NULL AUTO_INCREMENT,
        rideId BIGINT NOT NULL,
        userId INT NOT NULL,
        rating TINYINT NOT NULL,
        review VARCHAR(500) DEFAULT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_rating_ride_user (rideId, userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    `CREATE TABLE IF NOT EXISTS event (
        id INT NOT NULL AUTO_INCREMENT,
        name VARCHAR(150) NOT NULL,
        ownerId INT DEFAULT NULL,
        description TEXT,
        eventDate DATE DEFAULT NULL,
        eventTime VARCHAR(10) DEFAULT NULL,
        location VARCHAR(150) DEFAULT NULL,
        category VARCHAR(50) DEFAULT NULL,
        image LONGTEXT,
        attendees LONGTEXT,
        maxAttendees INT DEFAULT NULL,
        isCompany TINYINT(1) NOT NULL DEFAULT 0,
        companyName VARCHAR(100) DEFAULT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_event_owner (ownerId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
];

// [table, column, definition]
const COLUMNS = [
    ['user', 'subscribed', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['user', 'sub_start', 'TEXT NULL'],
    ['user', 'sub_expire', 'TEXT NULL'],
    ['user', 'sub_renew', 'LONGTEXT NULL'],
    ['user', 'google_id', 'VARCHAR(64) NULL'],
    ['passengerride', 'seats', 'INT NOT NULL DEFAULT 1'],
    ['passengerride', 'createdAt', 'DATETIME NULL DEFAULT CURRENT_TIMESTAMP'],
    ['notifications', 'link', 'VARCHAR(150) NULL'],
];

async function columnExists(table, column) {
    const row = await queryOne(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return row && Number(row.n) > 0;
}

async function tableExists(table) {
    const row = await queryOne(
        'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [table]
    );
    return row && Number(row.n) > 0;
}

// The live `passengerride` table has no primary key / auto increment, so inserts fail.
async function fixPassengerRideId() {
    if (!(await tableExists('passengerride'))) return;
    const col = await queryOne(
        `SELECT COLUMN_KEY AS k, EXTRA AS extra FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'passengerride' AND COLUMN_NAME = 'id'`
    );
    if (!col || /auto_increment/i.test(col.extra || '')) return;
    if (col.k === 'PRI') {
        await query('ALTER TABLE passengerride MODIFY id INT NOT NULL AUTO_INCREMENT');
    } else {
        await query('ALTER TABLE passengerride MODIFY id INT NOT NULL AUTO_INCREMENT PRIMARY KEY');
    }
    console.log('[schema] passengerride.id is now AUTO_INCREMENT PRIMARY KEY');
}

async function ensureSchema() {
    for (const sql of TABLES) {
        try {
            await query(sql);
        } catch (err) {
            console.error('[schema] table migration failed:', err.message);
        }
    }
    for (const [table, column, definition] of COLUMNS) {
        try {
            if ((await tableExists(table)) && !(await columnExists(table, column))) {
                await query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
                console.log(`[schema] added ${table}.${column}`);
            }
        } catch (err) {
            console.error(`[schema] adding ${table}.${column} failed:`, err.message);
        }
    }
    try {
        await fixPassengerRideId();
    } catch (err) {
        console.error('[schema] passengerride id fix failed:', err.message);
    }
}

module.exports = { ensureSchema };
