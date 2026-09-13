const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

router.post('/register-endpoint', webhookController.registerEndpoint);
router.get('/register-endpoint', webhookController.listEndpoints);
router.post('/deliver-event', webhookController.deliverEvent);
router.get('/deliveries', webhookController.listDeliveries);

module.exports = router;
