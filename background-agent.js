const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs-extra');
const winston = require('winston');
require('dotenv').config();

// Import our data collectors
const CryptoCollector = require('./collectors/crypto-collector');
const StockCollector = require('./collectors/stock-collector');  
const MetalsCollector = require('./collectors/metals-collector');
const ConsumerGoodsCollector = require('./collectors/consumer-goods-collector');
const LuxuryCollector = require('./collectors/luxury-collector');
const RealEstateCollector = require('./collectors/real-estate-collector');

// Configure logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class UniversalPriceAgent {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3001;
    this.dataStore = new Map();
    this.lastUpdate = new Map();
    this.updateHistory = new Map();
    this.isUpdating = false;
    
    // Initialize collectors
    this.collectors = {
      crypto: new CryptoCollector(logger),
      stocks: new StockCollector(logger),
      metals: new MetalsCollector(logger),
      consumer: new ConsumerGoodsCollector(logger),
      luxury: new LuxuryCollector(logger),
      realestate: new RealEstateCollector(logger)
    };
    
    this.setupServer();
    this.loadStoredData();
    this.startScheduledUpdates();
  }

  setupServer() {
    this.app.use(cors());
    this.app.use(express.json());
    
    // API Routes
    this.app.get('/api/prices', (req, res) => {
      const prices = {};
      this.dataStore.forEach((value, key) => {
        prices[key] = value.currentPrice;
      });
      res.json({
        prices,
        lastUpdate: Math.max(...Array.from(this.lastUpdate.values())),
        totalItems: this.dataStore.size
      });
    });

    this.app.get('/api/historical/:symbol', (req, res) => {
      const { symbol } = req.params;
      const { period = '1W' } = req.query;
      
      const data = this.getHistoricalData(symbol, period);
      res.json({
        symbol,
        period,
        data,
        dataPoints: data.length
      });
    });

    this.app.get('/api/status', (req, res) => {
      res.json({
        status: 'running',
        isUpdating: this.isUpdating,
        lastUpdate: Math.max(...Array.from(this.lastUpdate.values())),
        trackedItems: this.dataStore.size,
        collectors: Object.keys(this.collectors).map(key => ({
          name: key,
          status: this.collectors[key].getStatus()
        }))
      });
    });

    this.app.post('/api/update', async (req, res) => {
      if (this.isUpdating) {
        return res.status(429).json({ error: 'Update already in progress' });
      }
      
      try {
        await this.updateAllPrices();
        res.json({ success: true, message: 'Update completed' });
      } catch (error) {
        logger.error('Manual update failed:', error);
        res.status(500).json({ error: 'Update failed' });
      }
    });

    // Error handling
    this.app.use((err, req, res, next) => {
      logger.error('Express error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });

    this.app.listen(this.port, () => {
      logger.info(`Universal Price Agent running on port ${this.port}`);
    });
  }

  async loadStoredData() {
    try {
      const dataPath = './data/historical-data.json';
      if (await fs.pathExists(dataPath)) {
        const data = await fs.readJson(dataPath);
        
        Object.entries(data).forEach(([symbol, history]) => {
          this.updateHistory.set(symbol, history);
          if (history.length > 0) {
            const latest = history[history.length - 1];
            this.dataStore.set(symbol, {
              currentPrice: latest.price,
              timestamp: latest.timestamp,
              source: latest.source || 'stored',
              verified: latest.verified || false
            });
            this.lastUpdate.set(symbol, latest.timestamp);
          }
        });
        
        logger.info(`Loaded historical data for ${this.dataStore.size} items`);
      }
    } catch (error) {
      logger.error('Failed to load stored data:', error);
    }
  }

  async saveData() {
    try {
      await fs.ensureDir('./data');
      const dataToSave = {};
      
      this.updateHistory.forEach((history, symbol) => {
        // Keep only last 1000 data points per symbol to manage storage
        dataToSave[symbol] = history.slice(-1000);
      });
      
      await fs.writeJson('./data/historical-data.json', dataToSave, { spaces: 2 });
      logger.info('Data saved successfully');
    } catch (error) {
      logger.error('Failed to save data:', error);
    }
  }

  startScheduledUpdates() {
    // Update every 5 minutes during market hours
    cron.schedule('*/5 * * * *', async () => {
      const now = new Date();
      const hour = now.getHours();
      
      // More frequent updates during typical market hours (6 AM - 10 PM EST)
      if (hour >= 6 && hour <= 22) {
        await this.updateAllPrices();
      }
    });

    // Full update every hour during off-hours
    cron.schedule('0 * * * *', async () => {
      const now = new Date();
      const hour = now.getHours();
      
      // Less frequent updates during off-hours
      if (hour < 6 || hour > 22) {
        await this.updateAllPrices();
      }
    });

    // Save data every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      await this.saveData();
    });

    logger.info('Scheduled updates started');
  }

  async updateAllPrices() {
    if (this.isUpdating) {
      logger.warn('Update already in progress, skipping');
      return;
    }

    this.isUpdating = true;
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;

    try {
      logger.info('Starting price update cycle');

      // Update each category in parallel for efficiency
      const updatePromises = Object.entries(this.collectors).map(async ([category, collector]) => {
        try {
          const results = await collector.collectData();
          
          results.forEach(result => {
            if (result.success && result.price && result.price > 0) {
              this.updateItemData(result.symbol, result.price, result.source, result.verified);
              successCount++;
            } else {
              logger.warn(`Failed to update ${result.symbol}: ${result.error}`);
              errorCount++;
            }
          });
          
        } catch (error) {
          logger.error(`Collector ${category} failed:`, error);
          errorCount++;
        }
      });

      await Promise.all(updatePromises);
      
      const duration = Date.now() - startTime;
      logger.info(`Update cycle completed: ${successCount} success, ${errorCount} errors in ${duration}ms`);
      
    } catch (error) {
      logger.error('Update cycle failed:', error);
    } finally {
      this.isUpdating = false;
    }
  }

  updateItemData(symbol, price, source, verified = false) {
    const timestamp = Date.now();
    
    // Update current data
    this.dataStore.set(symbol, {
      currentPrice: price,
      timestamp,
      source,
      verified
    });
    
    this.lastUpdate.set(symbol, timestamp);
    
    // Add to history
    if (!this.updateHistory.has(symbol)) {
      this.updateHistory.set(symbol, []);
    }
    
    const history = this.updateHistory.get(symbol);
    history.push({
      price,
      timestamp,
      source,
      verified
    });
    
    // Keep only recent data (last 1000 points)
    if (history.length > 1000) {
      history.splice(0, history.length - 1000);
    }
  }

  getHistoricalData(symbol, period = '1W') {
    const history = this.updateHistory.get(symbol) || [];
    if (history.length === 0) return [];

    const now = Date.now();
    let cutoffTime;

    switch (period) {
      case '1H':
        cutoffTime = now - (60 * 60 * 1000);
        break;
      case '1D':
        cutoffTime = now - (24 * 60 * 60 * 1000);
        break;
      case '1W':
        cutoffTime = now - (7 * 24 * 60 * 60 * 1000);
        break;
      case '1M':
        cutoffTime = now - (30 * 24 * 60 * 60 * 1000);
        break;
      case '3M':
        cutoffTime = now - (90 * 24 * 60 * 60 * 1000);
        break;
      case '1Y':
        cutoffTime = now - (365 * 24 * 60 * 60 * 1000);
        break;
      default:
        cutoffTime = now - (7 * 24 * 60 * 60 * 1000); // Default to 1 week
    }

    return history
      .filter(point => point.timestamp >= cutoffTime)
      .map(point => ({
        price: point.price,
        timestamp: point.timestamp,
        verified: point.verified || false
      }));
  }
}

// Start the agent
const agent = new UniversalPriceAgent();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  await agent.saveData();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  await agent.saveData();
  process.exit(0);
});