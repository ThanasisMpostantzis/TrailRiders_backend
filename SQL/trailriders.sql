-- phpMyAdmin SQL Dump
-- version 5.2.0
-- https://www.phpmyadmin.net/
--
-- Εξυπηρετητής: 127.0.0.1
-- Χρόνος δημιουργίας: 25 Νοε 2025 στις 11:35:39
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
  `joinedRiders` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '[]' CHECK (json_valid(`joinedRiders`)),
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
  `expectedTime` int(20) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- Άδειασμα δεδομένων του πίνακα `rides`
--

INSERT INTO `rides` (`id`, `organizer`, `title`, `joinedRiders`, `image`, `rideDistance`, `startLocation`, `finishLocation`, `date`, `status`, `category`, `description`, `stops`, `difficulty`, `rideType`, `expectedTime`) VALUES
(1, 'thanasis mpostantzis', 'Πάμε καζίνο λουτράκι', '[\"thanasis\", \"aggelos\", \"george\", \"petros\", \"jason\"]', 'scr.mplamplampla', 100, 'thessaloniki', 'athina', '2025-11-26', 'upcoming', 'supersport / naked / onOff', 'παμε να χασουμε τα λεφτα μας', '[\"katerini\", \"domoko\", \"megara\"]', 'medium', 'Άσφαλτος', 6),
(2, 'Άγγελος', 'Βόλτα στην Πτολεμαίδα', '[]', 'image.jpg', 50.5, 'Θεσσαλονίκη', 'Πτολεμαίδα', '2026-05-29', 'upcoming', 'Trip', 'Χαλαρή βόλτα για καφέ', '[\"Stasi 1\",\"Stasi 2\"]', 'Easy', 'Road Ride', 120),
(3, 'Jason', 'Βόλτα στην Θεσσαλονίκη', '[\"thanasis\"],\"takis\"]', 'image8.jpg', 5.5, 'Θεσσαλονίκη', 'Θεσσαλονίκη', '2025-12-29', 'upcoming', 'Trip', 'Βόλτα για ποτό', '[\"Stasi 1\",\"Stasi 2\",\"Stasi 3\"]', 'Easy', 'Road Ride', 2),
(4, 'Jason', 'Βόλτα στην Θεσσαλονίκη', '[\"nikos\"]', 'image8.jpg', 5.5, 'Θεσσαλονίκη', 'Θεσσαλονίκη', '2025-12-29', 'upcoming', 'Trip', 'Βόλτα για ποτό', '[\"Stasi 1\",\"Stasi 2\",\"Stasi 3\"]', 'Easy', 'Road Ride', 2);

-- --------------------------------------------------------

--
-- Δομή πίνακα για τον πίνακα `user`
--

CREATE TABLE `user` (
  `id` int(11) NOT NULL,
  `username` varchar(12) NOT NULL,
  `password` varchar(64) NOT NULL,
  `email` varchar(30) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- Άδειασμα δεδομένων του πίνακα `user`
--

INSERT INTO `user` (`id`, `username`, `password`, `email`) VALUES
(1, 'test123', '111111', 'specgame512@gmail.com'),
(2, 'thanasis', '1234', 'tmpostantzis@gmail.com'),
(3, 'aggelos', '1234', 'aggelosbendaj6@gmail.com'),
(4, 'Thanasis@gma', 'tmpostantzis', '123456'),
(5, 'tmpostantzis', '123456', 'tmpostantzis@gmail.com'),
(6, 'Tmpost', '123456', 'Thanasis@yahoo.gr'),
(7, 'Bendaj', '1234', 'aggelobendaj@yahoo.gr'),
(8, 'george3', '12345', 'goergekz@yahoo.gr'),
(9, 'dgegeg', '12345', 'wgd@sg.rb'),
(10, 'jason', 'Qwert', 'jason@gmail.com'),
(11, 'bendajj', '12345', 'aggelobendaj@yahoo.gr'),
(12, 'koo', '123456', 'xjxjaj@gmakxu.hsj');

--
-- Ευρετήρια για άχρηστους πίνακες
--

--
-- Ευρετήρια για πίνακα `rides`
--
ALTER TABLE `rides`
  ADD PRIMARY KEY (`id`);

--
-- Ευρετήρια για πίνακα `user`
--
ALTER TABLE `user`
  ADD KEY `id` (`id`);

--
-- AUTO_INCREMENT για άχρηστους πίνακες
--

--
-- AUTO_INCREMENT για πίνακα `rides`
--
ALTER TABLE `rides`
  MODIFY `id` bigint(255) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT για πίνακα `user`
--
ALTER TABLE `user`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
