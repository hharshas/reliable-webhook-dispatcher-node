const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const WebhookDelivery = sequelize.define(
  'WebhookDelivery',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    webhookEndpointId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'webhook_endpoint_id',
    },
    url: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    eventGroup: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'event_group',
    },
    eventName: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'event_name',
    },
    requestBody: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: 'request_body',
    },
    payloadCreatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'payload_created_at',
    },
    shipmentTime: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'shipment_time',
    },
    nextAttemptAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'next_attempt_at',
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'queued',
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    maxAttempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
      field: 'max_attempts',
    },
    sequence: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    lockedBy: {
      type: DataTypes.STRING,
      field: 'locked_by',
    },
    lockedUntil: {
      type: DataTypes.DATE,
      field: 'locked_until',
    },
    lastStatusCode: {
      type: DataTypes.INTEGER,
      field: 'last_status_code',
    },
    lastError: {
      type: DataTypes.TEXT,
      field: 'last_error',
    },
    deliveredAt: {
      type: DataTypes.DATE,
      field: 'delivered_at',
    },
  },
  {
    tableName: 'webhook_deliveries',
    timestamps: true,
  }
);

module.exports = WebhookDelivery;
