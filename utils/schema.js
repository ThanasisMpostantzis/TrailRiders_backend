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

    // Direct messages between two users
    `CREATE TABLE IF NOT EXISTS messages (
        id INT NOT NULL AUTO_INCREMENT,
        senderId INT NOT NULL,
        receiverId INT NOT NULL,
        text VARCHAR(2000) NOT NULL,
        readAt DATETIME DEFAULT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_messages_pair (senderId, receiverId),
        KEY idx_messages_receiver (receiverId, readAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    `CREATE TABLE IF NOT EXISTS follows (
        followerId INT NOT NULL,
        followingId INT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (followerId, followingId),
        KEY idx_follows_following (followingId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    `CREATE TABLE IF NOT EXISTS blocks (
        blockerId INT NOT NULL,
        blockedId INT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (blockerId, blockedId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    // Reports of users / content, reviewed by the team (App Store & Play Store requirement)
    `CREATE TABLE IF NOT EXISTS reports (
        id INT NOT NULL AUTO_INCREMENT,
        reporterId INT NOT NULL,
        targetType VARCHAR(20) NOT NULL,
        targetId BIGINT NOT NULL,
        reason VARCHAR(50) NOT NULL,
        details VARCHAR(1000) DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_reports_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    // ---------- FEED (social posts) ----------
    `CREATE TABLE IF NOT EXISTS posts (
        id INT NOT NULL AUTO_INCREMENT,
        userId INT NOT NULL,
        text VARCHAR(2000) DEFAULT NULL,
        images LONGTEXT,
        category VARCHAR(40) DEFAULT NULL,
        location VARCHAR(120) DEFAULT NULL,
        rideId BIGINT DEFAULT NULL,
        trackId INT DEFAULT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_posts_user (userId),
        KEY idx_posts_created (createdAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    `CREATE TABLE IF NOT EXISTS post_likes (
        postId INT NOT NULL,
        userId INT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (postId, userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    `CREATE TABLE IF NOT EXISTS post_comments (
        id INT NOT NULL AUTO_INCREMENT,
        postId INT NOT NULL,
        userId INT NOT NULL,
        text VARCHAR(1000) NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_post_comments_post (postId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    // ---------- GPS ride recordings ----------
    `CREATE TABLE IF NOT EXISTS tracks (
        id INT NOT NULL AUTO_INCREMENT,
        userId INT NOT NULL,
        title VARCHAR(120) DEFAULT NULL,
        startedAt DATETIME NOT NULL,
        endedAt DATETIME NOT NULL,
        durationSec INT NOT NULL DEFAULT 0,
        movingSec INT NOT NULL DEFAULT 0,
        distanceM DOUBLE NOT NULL DEFAULT 0,
        maxSpeedKmh DOUBLE NOT NULL DEFAULT 0,
        avgSpeedKmh DOUBLE NOT NULL DEFAULT 0,
        maxLeanLeft DOUBLE DEFAULT NULL,
        maxLeanRight DOUBLE DEFAULT NULL,
        maxGForce DOUBLE DEFAULT NULL,
        avgGForce DOUBLE DEFAULT NULL,
        elevationGainM DOUBLE DEFAULT NULL,
        maxAltitudeM DOUBLE DEFAULT NULL,
        minAltitudeM DOUBLE DEFAULT NULL,
        startName VARCHAR(120) DEFAULT NULL,
        endName VARCHAR(120) DEFAULT NULL,
        points LONGTEXT,
        rideId BIGINT DEFAULT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_tracks_user (userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    // ---------- Route library (best roads, shared by riders) ----------
    `CREATE TABLE IF NOT EXISTS route_library (
        id INT NOT NULL AUTO_INCREMENT,
        userId INT NOT NULL,
        name VARCHAR(120) NOT NULL,
        description TEXT,
        region VARCHAR(80) DEFAULT NULL,
        difficulty VARCHAR(20) DEFAULT NULL,
        surface VARCHAR(30) DEFAULT NULL,
        style VARCHAR(30) DEFAULT NULL,
        distanceM DOUBLE NOT NULL DEFAULT 0,
        durationSec INT DEFAULT NULL,
        elevationGainM DOUBLE DEFAULT NULL,
        startLat DOUBLE DEFAULT NULL,
        startLng DOUBLE DEFAULT NULL,
        endLat DOUBLE DEFAULT NULL,
        endLng DOUBLE DEFAULT NULL,
        startName VARCHAR(120) DEFAULT NULL,
        endName VARCHAR(120) DEFAULT NULL,
        points LONGTEXT,
        image LONGTEXT,
        trackId INT DEFAULT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_route_library_user (userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    `CREATE TABLE IF NOT EXISTS route_ratings (
        routeId INT NOT NULL,
        userId INT NOT NULL,
        rating TINYINT NOT NULL,
        review VARCHAR(500) DEFAULT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (routeId, userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    `CREATE TABLE IF NOT EXISTS route_favorites (
        routeId INT NOT NULL,
        userId INT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (routeId, userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    // ---------- Marketplace (classifieds) ----------
    `CREATE TABLE IF NOT EXISTS listings (
        id INT NOT NULL AUTO_INCREMENT,
        userId INT NOT NULL,
        title VARCHAR(120) NOT NULL,
        description TEXT,
        category VARCHAR(30) NOT NULL,
        price DECIMAL(10,2) DEFAULT NULL,
        negotiable TINYINT(1) NOT NULL DEFAULT 0,
        itemCondition VARCHAR(20) DEFAULT NULL,
        brand VARCHAR(60) DEFAULT NULL,
        model VARCHAR(60) DEFAULT NULL,
        year INT DEFAULT NULL,
        km INT DEFAULT NULL,
        location VARCHAR(120) DEFAULT NULL,
        images LONGTEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        featuredUntil DATETIME DEFAULT NULL,
        views INT NOT NULL DEFAULT 0,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_listings_user (userId),
        KEY idx_listings_status (status, category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    `CREATE TABLE IF NOT EXISTS listing_favorites (
        listingId INT NOT NULL,
        userId INT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (listingId, userId)
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
    ['user', 'termsAcceptedAt', 'DATETIME NULL'],
    // Private rides (join with an access code)
    ['rides', 'visibility', "VARCHAR(10) NOT NULL DEFAULT 'public'"],
    ['rides', 'accessCode', 'VARCHAR(20) NULL'],
    // Emergency (ICE) info, visible only to the user and shown on the SOS screen
    ['user', 'bloodType', 'VARCHAR(5) NULL'],
    ['user', 'allergies', 'VARCHAR(255) NULL'],
    ['user', 'medicalNotes', 'VARCHAR(500) NULL'],
    ['user', 'emergencyName', 'VARCHAR(100) NULL'],
    ['user', 'emergencyPhone', 'VARCHAR(30) NULL'],
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
