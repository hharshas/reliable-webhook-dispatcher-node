const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Item = sequelize.define(
  'Item',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: 'items',
    timestamps: true,
  }
);

module.exports = Item;
