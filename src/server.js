const app = require('./app');
const config = require('./config');
const { sequelize } = require('./models');
const { startWebhookWorker } = require('./services/webhookQueue.service');

const start = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established.');

    // For a boilerplate, sync() auto-creates and updates tables from models.
    // Swap for sequelize-cli migrations in a real project.
    await sequelize.sync({ alter: true });
    console.log('Models synced.');

    startWebhookWorker();

    app.listen(config.port, () => {
      console.log(`Server listening on port ${config.port}`);
    });
  } catch (err) {
    console.error('Unable to start server:', err);
    process.exit(1);
  }
};

start();
