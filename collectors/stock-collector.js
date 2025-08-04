const axios = require('axios');
const cheerio = require('cheerio');

class StockCollector {
  constructor(logger) {
    this.logger = logger;
    this.name = 'Stock Index Collector';
    
    // Stock symbols we track (ETFs that track major indices)
    this.stocks = {
      'SPY': 'S&P 500',
      'QQQ': 'NASDAQ-100', 
      'DIA': 'Dow Jones'
    };
    
    this.lastUpdate = 0;
    this.status = 'initialized';
  }

  async collectData() {
    this.status = 'collecting';
    const results = [];
    
    try {
      // Collect data for each stock
      for (const symbol of Object.keys(this.stocks)) {
        const result = await this.collectStockPrice(symbol);
        results.push(result);
      }
      
      this.lastUpdate = Date.now();
      this.status = 'completed';
      
    } catch (error) {
      this.logger.error('Stock collection failed:', error);
      this.status = 'error';
    }
    
    return results;
  }

  async collectStockPrice(symbol) {
    const sources = [];
    
    try {
      // Source 1: Alpha Vantage API (free tier available)
      try {
        if (process.env.ALPHA_VANTAGE_API_KEY) {
          const avPrice = await this.getAlphaVantagePrice(symbol);
          if (avPrice) {
            sources.push({ source: 'AlphaVantage', price: avPrice, reliability: 0.92 });
          }
        }
      } catch (error) {
        this.logger.warn(`AlphaVantage failed for ${symbol}:`, error.message);
      }

      // Source 2: Financial Modeling Prep API
      try {
        if (process.env.FMP_API_KEY) {
          const fmpPrice = await this.getFmpPrice(symbol);
          if (fmpPrice) {
            sources.push({ source: 'FinancialModelingPrep', price: fmpPrice, reliability: 0.90 });
          }
        }
      } catch (error) {
        this.logger.warn(`FMP failed for ${symbol}:`, error.message);
      }

      // Source 3: Scrape from Yahoo Finance
      try {
        const yahooPrice = await this.scrapeYahooFinance(symbol);
        if (yahooPrice) {
          sources.push({ source: 'Yahoo Finance', price: yahooPrice, reliability: 0.88 });
        }
      } catch (error) {
        this.logger.warn(`Yahoo Finance failed for ${symbol}:`, error.message);
      }

      // Source 4: Scrape from MarketWatch
      try {
        const marketWatchPrice = await this.scrapeMarketWatch(symbol);
        if (marketWatchPrice) {
          sources.push({ source: 'MarketWatch', price: marketWatchPrice, reliability: 0.86 });
        }
      } catch (error) {
        this.logger.warn(`MarketWatch failed for ${symbol}:`, error.message);
      }

      // Source 5: IEX Cloud API (if available)
      try {
        if (process.env.IEX_API_KEY) {
          const iexPrice = await this.getIexPrice(symbol);
          if (iexPrice) {
            sources.push({ source: 'IEX Cloud', price: iexPrice, reliability: 0.89 });
          }
        }
      } catch (error) {
        this.logger.warn(`IEX Cloud failed for ${symbol}:`, error.message);
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

  async getAlphaVantagePrice(symbol) {
    const response = await axios.get('https://www.alphavantage.co/query', {
      params: {
        function: 'GLOBAL_QUOTE',
        symbol: symbol,
        apikey: process.env.ALPHA_VANTAGE_API_KEY
      },
      timeout: 10000
    });

    const quote = response.data['Global Quote'];
    if (quote && quote['05. price']) {
      return parseFloat(quote['05. price']);
    }

    return null;
  }

  async getFmpPrice(symbol) {
    const response = await axios.get(`https://financialmodelingprep.com/api/v3/quote/${symbol}`, {
      params: {
        apikey: process.env.FMP_API_KEY
      },
      timeout: 10000
    });

    if (response.data && response.data.length > 0) {
      return response.data[0].price;
    }

    return null;
  }

  async getIexPrice(symbol) {
    const response = await axios.get(`https://cloud.iexapis.com/stable/stock/${symbol}/quote`, {
      params: {
        token: process.env.IEX_API_KEY
      },
      timeout: 10000
    });

    if (response.data && response.data.latestPrice) {
      return response.data.latestPrice;
    }

    return null;
  }

  async scrapeYahooFinance(symbol) {
    try {
      const response = await axios.get(`https://finance.yahoo.com/quote/${symbol}`, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Look for the current price
      const priceSelectors = [
        '[data-symbol="' + symbol + '"] [data-field="regularMarketPrice"]',
        '.Trsdu\\(0\\.3s\\)[data-reactid] span',
        'fin-streamer[data-symbol="' + symbol + '"][data-field="regularMarketPrice"]',
        '.Fw\\(b\\).Fz\\(36px\\).Mb\\(-4px\\).D\\(ib\\)'
      ];

      for (const selector of priceSelectors) {
        const priceElement = $(selector).first();
        if (priceElement.length) {
          const priceText = priceElement.text().trim();
          const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
          
          // Sanity check for stock prices
          if (price > 10 && price < 1000) {
            return price;
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.warn(`Yahoo Finance scraping failed for ${symbol}:`, error.message);
      return null;
    }
  }

  async scrapeMarketWatch(symbol) {
    try {
      const response = await axios.get(`https://www.marketwatch.com/investing/fund/${symbol}`, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Look for the current price
      const priceSelectors = [
        '.intraday__price .value',
        '.quote__price .value',
        'bg-quote[data-symbol="' + symbol + '"] .value',
        '.last-price'
      ];

      for (const selector of priceSelectors) {
        const priceElement = $(selector).first();
        if (priceElement.length) {
          const priceText = priceElement.text().trim();
          const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
          
          // Sanity check for stock prices
          if (price > 10 && price < 1000) {
            return price;
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.warn(`MarketWatch scraping failed for ${symbol}:`, error.message);
      return null;
    }
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
    
    // If variance is low (< 0.5% for stocks), data is verified
    const verified = coefficientOfVariation < 0.005;
    
    // Use the most reliable source as primary
    const primarySource = sources.sort((a, b) => b.reliability - a.reliability)[0];
    
    this.logger.info(`Stock price verification for ${sources[0]?.symbol}: CV=${(coefficientOfVariation * 100).toFixed(2)}%, verified=${verified}`);
    
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
      symbols: Object.keys(this.stocks).length
    };
  }
}

module.exports = StockCollector;