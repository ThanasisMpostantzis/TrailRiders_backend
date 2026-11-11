-- Run AFTER importing trailriders.sql (MySQL 8 or MariaDB).
-- The backend applies all of this automatically on startup (utils/schema.js) and skips what already exists.
-- If you run it by hand, skip ALTER statements for columns that already exist.

CREATE TABLE IF NOT EXISTS notifications (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS ride_comments (
  id INT NOT NULL AUTO_INCREMENT,
  rideId BIGINT NOT NULL,
  userId INT NOT NULL,
  text VARCHAR(1000) NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_comments_ride (rideId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS ride_ratings (
  id INT NOT NULL AUTO_INCREMENT,
  rideId BIGINT NOT NULL,
  userId INT NOT NULL,
  rating TINYINT NOT NULL,
  review VARCHAR(500) DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rating_ride_user (rideId, userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS event (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Columns (present in trailriders.sql but missing on some databases)
ALTER TABLE user ADD COLUMN subscribed TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE user ADD COLUMN sub_start TEXT NULL;
ALTER TABLE user ADD COLUMN sub_expire TEXT NULL;
ALTER TABLE user ADD COLUMN sub_renew LONGTEXT NULL;
ALTER TABLE user ADD COLUMN google_id VARCHAR(64) NULL;
ALTER TABLE passengerride ADD COLUMN seats INT NOT NULL DEFAULT 1;
ALTER TABLE passengerride ADD COLUMN createdAt DATETIME NULL DEFAULT CURRENT_TIMESTAMP;

-- passengerride.id needs to be an auto-increment primary key
ALTER TABLE passengerride MODIFY id INT NOT NULL AUTO_INCREMENT PRIMARY KEY;
