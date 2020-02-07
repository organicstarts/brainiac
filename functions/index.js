const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const basicAuth = require('express-basic-auth');

const wholesale = express();
wholesale.use(cors({ origin: true }));
wholesale.use(basicAuth({
    users: { 
        'elena': 'supersecret' 
    }
}));

wholesale.post('/', async (req, res) => {

});

exports.wholesale = functions.https.onRequest(wholesale);