'use strict';


// CONFIG
require("dotenv").config();

const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');


// ROUTE VARS
const indexRouter = require('./routes/index.js');
const authRouter = require('./config/auth.js');
const apiRouter = require('./routes/api.js');
const eventRouter = require('./routes/event.js');
const ridesRoutes = require('./routes/rides.js');
const passengerRidesRoutes = require('./routes/passengerRides.js');
const subscription = require('./routes/subscription.js');


// APP CONFIG
const app = express();
app.use(cookieParser());
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(cors());


// APP ROUTES
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/api', apiRouter);
app.use('/event', eventRouter);
app.use('/rides', ridesRoutes);
app.use('/passengerRides', passengerRidesRoutes);
app.use('/subscription', subscription);


// APP SERVER
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}...`);
});
