const axios = require('axios');
const cheerio = require('cheerio');

class CryptoCollector {
  constructor(logger) {
    this.logger = logger;
    this.name = 'Cryptocurrency Collector';
    this.sources = {
      coinGecko: 'https://api.coingecko.com/api/v3/simple/price',
      coinMarketCap: 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
      binance: 'https://api.binance.com/api/v3/ticker/price'
    };
    
    // Symbol mappings for different exchanges
    this.symbolMappings = {
      'BTC': { coinGecko: 'bitcoin', binance: 'BTCUSDT', cmc: 'BTC' },
      'ETH': { coinGecko: 'ethereum', binance: 'ETHUSDT', cmc: 'ETH' },
      'SOL': { coinGecko: 'solana', binance: 'SOLUSDT', cmc: 'SOL' },
      'DOGE': { coinGecko: 'dogecoin', binance: 'DOGEUSDT', cmc: 'DOGE' }
    };
    
    this.lastUpdate = 0;
    this.status = 'initialized';
  }

  async collectData() {
    this.status = 'collecting';
    const results = [];
    
    try {
      // Collect data for each cryptocurrency
      for (const [symbol, mappings] of Object.entries(this.symbolMappings)) {
        const result = await this.collectCryptoPrice(symbol, mappings);
        results.push(result);
      }
      
      this.lastUpdate = Date.now();
      this.status = 'completed';
      
    } catch (error) {
      this.logger.error('Crypto collection failed:', error);
      this.status = 'error';
    }
    
    return results;
  }

  async collectCryptoPrice(symbol, mappings) {
    const sources = [];
    
    try {
      // Source 1: CoinGecko (free, reliable)
      try {
        const cgPrice = await this.getCoinGeckoPrice(mappings.coinGecko);
        if (cgPrice) {
          sources.push({ source: 'CoinGecko', price: cgPrice, reliability: 0.9 });
        }
      } catch (error) {
        this.logger.warn(`CoinGecko failed for ${symbol}:`, error.message);
      }

      // Source 2: Binance (exchange data, very reliable)
      try {
        const binancePrice = await this.getBinancePrice(mappings.binance);
        if (binancePrice) {
          sources.push({ source: 'Binance', price: binancePrice, reliability: 0.95 });
        }
      } catch (error) {
        this.logger.warn(`Binance failed for ${symbol}:`, error.message);
      }

      // Source 3: CoinMarketCap (requires API key, but very comprehensive)
      try {
        if (process.env.COINMARKETCAP_API_KEY) {
          const cmcPrice = await this.getCoinMarketCapPrice(mappings.cmc);
          if (cmcPrice) {
            sources.push({ source: 'CoinMarketCap', price: cmcPrice, reliability: 0.92 });
          }
        }
      } catch (error) {
        this.logger.warn(`CoinMarketCap failed for ${symbol}:`, error.message);
      }

      // Verify and consolidate data
      if (sources.length === 0) {
        return {
          symbol,
          success: false,
          error: 'No sources available',
          price: null,
          source: null,
          verified: false
        };
      }

      const verifiedPrice = this.verifyAndConsolidate(sources);
      
      return {
        symbol,
        success: true,
        price: verifiedPrice.price,
        source: verifiedPrice.primarySource,
        verified: verifiedPrice.verified,
        sources: sources.length,
        variance: verifiedPrice.variance
      };

    } catch (error) {
      this.logger.error(`Failed to collect ${symbol}:`, error);
      return {
        symbol,
        success: false,
        error: error.message,
        price: null,
        source: null,
        verified: false
      };
    }
  }

  async getCoinGeckoPrice(coinId) {
    const response = await axios.get(this.sources.coinGecko, {
      params: {
        ids: coinId,
        vs_currencies: 'usd'
      },
      timeout: 10000
    });
    
    return response.data[coinId]?.usd;
  }

  async getBinancePrice(symbol) {
    const response = await axios.get(this.sources.binance, {
      params: { symbol },
      timeout: 10000
    });
    
    return parseFloat(response.data.price);
  }

  async getCoinMarketCapPrice(symbol) {
    const response = await axios.get(this.sources.coinMarketCap, {
      headers: {
        'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY
      },
      params: {
        symbol: symbol,
        convert: 'USD'
      },
      timeout: 10000
    });
    
    return response.data.data[symbol]?.quote?.USD?.price;
  }

  verifyAndConsolidate(sources) {
    if (sources.length === 1) {
      return {
        price: sources[0].price,
        primarySource: sources[0].source,
        verified: false,
        variance: 0
      };
    }

    // Calculate weighted average based on source reliability
    let totalWeight = 0;
    let weightedSum = 0;
    
    sources.forEach(source => {
      totalWeight += source.reliability;
      weightedSum += source.price * source.reliability;
    });
    
    const weightedAverage = weightedSum / totalWeight;
    
    // Calculate variance to detect outliers
    const prices = sources.map(s => s.price);
    const mean = prices.reduce((a, b) => a + b) / prices.length;
    const variance = prices.reduce((acc, price) => acc + Math.pow(price - mean, 2), 0) / prices.length;
    const standardDeviation = Math.sqrt(variance);
    const coefficientOfVariation = standardDeviation / mean;
    
    // If variance is low (< 2%), data is verified
    const verified = coefficientOfVariation < 0.02;
    
    // Use the most reliable source as primary
    const primarySource = sources.sort((a, b) => b.reliability - a.reliability)[0];
    
    this.logger.info(`${sources[0].source} price verification: CV=${(coefficientOfVariation * 100).toFixed(2)}%, verified=${verified}`);
    
    return {
      price: verified ? weightedAverage : primarySource.price,
      primarySource: primarySource.source,
      verified,
      variance: coefficientOfVariation
    };
  }

  getStatus() {
    return {
      name: this.name,
      status: this.status,
      lastUpdate: this.lastUpdate,
      sources: Object.keys(this.sources).length,
      symbols: Object.keys(this.symbolMappings).length
    };
  }
}

module.exports = CryptoCollector;