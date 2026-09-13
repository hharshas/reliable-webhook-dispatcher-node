const express = require('express');
const router = express.Router();
const itemRoutes = require('./item.routes');
const webhookRoutes = require('./webhook.routes');

router.use('/items', itemRoutes);
router.use('/', webhookRoutes);

module.exports = router;
