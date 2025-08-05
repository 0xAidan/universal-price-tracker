const axios = require('axios');
const cheerio = require('cheerio');

class MetalsCollector {
  constructor(logger) {
    this.logger = logger;
    this.name = 'Precious Metals Collector';
    
    // Metal symbols we track
    this.metals = ['XAU', 'XAG', 'XPT', 'XPD']; // Gold, Silver, Platinum, Palladium
    
    this.lastUpdate = 0;
    this.status = 'initialized';
  }

  async collectData() {
    this.status = 'collecting';
    const results = [];
    
    try {
      // Collect data for each metal
      for (const metal of this.metals) {
        const result = await this.collectMetalPrice(metal);
        results.push(result);
      }
      
      this.lastUpdate = Date.now();
      this.status = 'completed';
      
    } catch (error) {
      this.logger.error('Metals collection failed:', error);
      this.status = 'error';
    }
    
    return results;
  }

  async collectMetalPrice(symbol) {
    const sources = [];
    
    try {
      // Source 1: Metals-API.com (free tier available)
      try {
        const metalsApiPrice = await this.getMetalsApiPrice(symbol);
        if (metalsApiPrice) {
          sources.push({ source: 'MetalsAPI', price: metalsApiPrice, reliability: 0.9 });
        }
      } catch (error) {
        this.logger.warn(`MetalsAPI failed for ${symbol}:`, error.message);
      }

      // Source 2: Scrape from GoldPrice.org
      try {
        if (symbol === 'XAU') { // Gold only
          const goldPriceOrg = await this.scrapeGoldPriceOrg();
          if (goldPriceOrg) {
            sources.push({ source: 'GoldPrice.org', price: goldPriceOrg, reliability: 0.85 });
          }
        }
      } catch (error) {
        this.logger.warn(`GoldPrice.org failed:`, error.message);
      }

      // Source 3: Scrape from APMEX.com
      try {
        const apmexPrice = await this.scrapeApmexPrice(symbol);
        if (apmexPrice) {
          sources.push({ source: 'APMEX', price: apmexPrice, reliability: 0.88 });
        }
      } catch (error) {
        this.logger.warn(`APMEX failed for ${symbol}:`, error.message);
      }

      // Source 4: Financial modeling prep API (requires key)
      try {
        if (process.env.FMP_API_KEY) {
          const fmpPrice = await this.getFmpPrice(symbol);
          if (fmpPrice) {
            sources.push({ source: 'FinancialModelingPrep', price: fmpPrice, reliability: 0.92 });
          }
        }
      } catch (error) {
        this.logger.warn(`FMP failed for ${symbol}:`, error.message);
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

  async getMetalsApiPrice(symbol) {
    // Metals-API.com - free tier allows 1000 requests/month
    const apiKey = process.env.METALS_API_KEY;
    if (!apiKey) return null;

    const response = await axios.get(`https://metals-api.com/api/latest`, {
      params: {
        access_key: apiKey,
        base: 'USD',
        symbols: symbol
      },
      timeout: 10000
    });

    if (response.data.success && response.data.rates[symbol]) {
      // Metals API returns price per unit, but we want price per ounce
      // The API returns inverse rates (1 USD = X oz), so we need 1/X for price per oz
      return 1 / response.data.rates[symbol];
    }

    return null;
  }

  async scrapeGoldPriceOrg() {
    try {
      const response = await axios.get('https://goldprice.org/', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Look for the current gold price per ounce
      const priceText = $('[data-price-usd]').first().attr('data-price-usd') || 
                       $('.price-value').first().text() ||
                       $('span:contains("$")').first().text();

      if (priceText) {
        const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
        if (price > 1000 && price < 5000) { // Sanity check for gold price range
          return price;
        }
      }

      return null;
    } catch (error) {
      this.logger.warn('GoldPrice.org scraping failed:', error.message);
      return null;
    }
  }

  async scrapeApmexPrice(symbol) {
    try {
      const metalNames = {
        'XAU': 'gold',
        'XAG': 'silver', 
        'XPT': 'platinum',
        'XPD': 'palladium'
      };
      
      const metalName = metalNames[symbol];
      if (!metalName) return null;

      const response = await axios.get(`https://www.apmex.com/category/10000/${metalName}`, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Look for spot price information
      const spotPriceSelector = `.spot-price, .metal-spot-price, [data-spot-price], .current-price`;
      const priceElement = $(spotPriceSelector).first();
      
      if (priceElement.length) {
        const priceText = priceElement.text() || priceElement.attr('data-price');
        const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
        
        // Sanity checks based on typical price ranges
        const ranges = {
          'XAU': [1500, 3000],  // Gold: $1500-3000
          'XAG': [15, 50],      // Silver: $15-50
          'XPT': [800, 1500],   // Platinum: $800-1500
          'XPD': [1000, 3000]   // Palladium: $1000-3000
        };
        
        const [min, max] = ranges[symbol];
        if (price >= min && price <= max) {
          return price;
        }
      }

      return null;
    } catch (error) {
      this.logger.warn(`APMEX scraping failed for ${symbol}:`, error.message);
      return null;
    }
  }

  async getFmpPrice(symbol) {
    try {
      const response = await axios.get(`https://financialmodelingprep.com/api/v3/fx/${symbol}USD`, {
        params: {
          apikey: process.env.FMP_API_KEY
        },
        timeout: 10000
      });

      if (response.data && response.data.length > 0) {
        return response.data[0].price;
      }

      return null;
    } catch (error) {
      this.logger.warn(`FMP API failed for ${symbol}:`, error.message);
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
    
    // If variance is low (< 1% for metals), data is verified
    const verified = coefficientOfVariation < 0.01;
    
    // Use the most reliable source as primary
    const primarySource = sources.sort((a, b) => b.reliability - a.reliability)[0];
    
    this.logger.info(`Metals price verification: CV=${(coefficientOfVariation * 100).toFixed(2)}%, verified=${verified}`);
    
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
      symbols: this.metals.length
    };
  }
}

module.exports = MetalsCollector;