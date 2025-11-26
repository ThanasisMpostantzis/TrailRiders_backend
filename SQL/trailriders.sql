-- phpMyAdmin SQL Dump
-- version 5.2.0
-- https://www.phpmyadmin.net/
--
-- Εξυπηρετητής: 127.0.0.1
-- Χρόνος δημιουργίας: 26 Νοε 2025 στις 01:32:00
-- Έκδοση διακομιστή: 10.4.24-MariaDB
-- Έκδοση PHP: 8.1.6

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Βάση δεδομένων: `trailriders`
--

-- --------------------------------------------------------

--
-- Δομή πίνακα για τον πίνακα `rides`
--

CREATE TABLE `rides` (
  `id` bigint(255) NOT NULL,
  `organizer` varchar(200) NOT NULL,
  `title` varchar(100) NOT NULL,
  `usersId` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '\'[]\'',
  `image` varchar(200) NOT NULL,
  `rideDistance` double NOT NULL,
  `startLocation` varchar(100) NOT NULL,
  `finishLocation` varchar(100) NOT NULL,
  `date` date NOT NULL,
  `status` varchar(100) NOT NULL,
  `category` varchar(100) NOT NULL,
  `description` varchar(1000) NOT NULL,
  `stops` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '[]' CHECK (json_valid(`stops`)),
  `difficulty` varchar(100) NOT NULL,
  `rideType` varchar(100) NOT NULL,
  `expectedTime` int(20) NOT NULL,
  `startLat` double DEFAULT NULL,
  `startLng` double DEFAULT NULL,
  `endLat` double DEFAULT NULL,
  `endLng` double DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- Άδειασμα δεδομένων του πίνακα `rides`
--

INSERT INTO `rides` (`id`, `organizer`, `title`, `usersId`, `image`, `rideDistance`, `startLocation`, `finishLocation`, `date`, `status`, `category`, `description`, `stops`, `difficulty`, `rideType`, `expectedTime`, `startLat`, `startLng`, `endLat`, `endLng`) VALUES
(1, 'thanasis mpostantzis', 'Πάμε καζίνο λουτράκι', '[1, 2, 3]', 'scr.mplamplampla', 100, 'thessaloniki', 'athina', '2025-11-26', 'upcoming', 'supersport / naked / onOff', 'παμε να χασουμε τα λεφτα μας', '[\"katerini\", \"domoko\", \"megara\"]', 'medium', 'Άσφαλτος', 6, NULL, NULL, NULL, NULL),
(2, 'Άγγελος', 'Βόλτα στην Πτολεμαίδα', '[4, 5, 6]', 'image.jpg', 50.5, 'Θεσσαλονίκη', 'Πτολεμαίδα', '2026-05-29', 'upcoming', 'Trip', 'Χαλαρή βόλτα για καφέ', '[\"Stasi 1\",\"Stasi 2\"]', 'Easy', 'Road Ride', 120, NULL, NULL, NULL, NULL),
(3, 'Jason', 'Βόλτα στην Θεσσαλονίκη', '[7, 8, 9]', 'image8.jpg', 5.5, 'Θεσσαλονίκη', 'Θεσσαλονίκη', '2025-12-29', 'upcoming', 'Trip', 'Βόλτα για ποτό', '[\"Stasi 1\",\"Stasi 2\",\"Stasi 3\"]', 'Easy', 'Road Ride', 2, NULL, NULL, NULL, NULL),
(4, 'Jason', 'Βόλτα στην Θεσσαλονίκη', '[10, 11, 12]', 'image8.jpg', 5.5, 'Θεσσαλονίκη', 'Θεσσαλονίκη', '2025-12-29', 'upcoming', 'Trip', 'Βόλτα για ποτό', '[\"Stasi 1\",\"Stasi 2\",\"Stasi 3\"]', 'Easy', 'Road Ride', 2, NULL, NULL, NULL, NULL),
(5, 'thanasis', 'Tepelene', '2', '', 0, 'Evosmos', 'Thessaloniki', '2025-11-26', 'upcoming', 'Road Trip', 'No description provided.', '[]', 'Medium', 'Road', 120, 40.66458629767115, 22.913869209587574, 40.61637255577618, 22.966260127723217);

--
-- Ευρετήρια για άχρηστους πίνακες
--

--
-- Ευρετήρια για πίνακα `rides`
--
ALTER TABLE `rides`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT για άχρηστους πίνακες
--

--
-- AUTO_INCREMENT για πίνακα `rides`
--
ALTER TABLE `rides`
  MODIFY `id` bigint(255) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
