const { DataTypes } = require('sequelize');
const validator = require('validator');
const sequelize = require('../config/database');

const WebhookEndpoint = sequelize.define(
  'WebhookEndpoint',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    url: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        // Sequelize's built-in `isUrl` validator ignores any options passed to it
        // (see sequelize/lib/utils/validator-extras.js), so `require_tld: false`
        // has no effect there. Call validator.js directly instead so local/internal
        // URLs (e.g. http://localhost:4000/hook) are accepted, not just public domains.
        isValidUrl(value) {
          const valid = validator.isURL(value, {
            require_tld: false, // allow local/internal hosts, e.g. http://localhost:4000/hook
            require_protocol: true, // reject bare words/hostnames with no scheme
            protocols: ['http', 'https'],
          });
          if (!valid) {
            throw new Error('url must be a valid http(s) URL');
          }
        },
      },
    },
    encryptionKey: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: 'encryption_key',
    },
  },
  {
    tableName: 'webhook_endpoints',
    timestamps: true,
  }
);

module.exports = WebhookEndpoint;
