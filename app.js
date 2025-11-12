'use strict';


// CONFIG
require("dotenv").config()

const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');


// ROUTE VARS
const indexRouter = require('./routes/index.js');


// APP CONFIG
const app = express();
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cors());


// APP ROUTES
app.use('/', indexRouter);


// APP SERVER
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}...`);
});
