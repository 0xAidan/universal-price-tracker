const axios = require('axios');
const cheerio = require('cheerio');

class ConsumerGoodsCollector {
  constructor(logger) {
    this.logger = logger;
    this.name = 'Consumer Goods Collector';
    
    // Consumer goods we track
    this.goods = {
      'EGGS': { name: 'Eggs (dozen)', unit: 'per dozen' },
      'MILK': { name: 'Milk (gallon)', unit: 'per gallon' },
      'GAS': { name: 'Gas (gallon)', unit: 'per gallon' },
      'COFFEE': { name: 'Coffee (lb)', unit: 'per pound' }
    };
    
    this.lastUpdate = 0;
    this.status = 'initialized';
  }

  async collectData() {
    this.status = 'collecting';
    const results = [];
    
    try {
      // Collect data for each good
      for (const symbol of Object.keys(this.goods)) {
        const result = await this.collectGoodPrice(symbol);
        results.push(result);
      }
      
      this.lastUpdate = Date.now();
      this.status = 'completed';
      
    } catch (error) {
      this.logger.error('Consumer goods collection failed:', error);
      this.status = 'error';
    }
    
    return results;
  }

  async collectGoodPrice(symbol) {
    const sources = [];
    
    try {
      // Different collection strategies per good type
      switch (symbol) {
        case 'EGGS':
          sources.push(...await this.collectEggsPrices());
          break;
        case 'MILK':
          sources.push(...await this.collectMilkPrices());
          break;
        case 'GAS':
          sources.push(...await this.collectGasPrices());
          break;
        case 'COFFEE':
          sources.push(...await this.collectCoffeePrices());
          break;
      }

      // Filter out null/invalid sources
      const validSources = sources.filter(s => s && s.price > 0);

      if (validSources.length === 0) {
        return {
          symbol,
          success: false,
          error: 'No valid sources available',
          price: null,
          source: null,
          verified: false
        };
      }

      const verifiedPrice = this.verifyAndConsolidate(validSources);
      
      return {
        symbol,
        success: true,
        price: verifiedPrice.price,
        source: verifiedPrice.primarySource,
        verified: verifiedPrice.verified,
        sources: validSources.length,
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

  async collectEggsPrices() {
    const sources = [];

    // Source 1: USDA NASS API (official agricultural data)
    try {
      const usdaPrice = await this.getUsdaEggsPrice();
      if (usdaPrice) {
        sources.push({ source: 'USDA', price: usdaPrice, reliability: 0.95 });
      }
    } catch (error) {
      this.logger.warn('USDA eggs price failed:', error.message);
    }

    // Source 2: Scrape from Walmart
    try {
      const walmartPrice = await this.scrapeWalmartEggs();
      if (walmartPrice) {
        sources.push({ source: 'Walmart', price: walmartPrice, reliability: 0.80 });
      }
    } catch (error) {
      this.logger.warn('Walmart eggs scraping failed:', error.message);
    }

    // Source 3: Scrape from Target
    try {
      const targetPrice = await this.scrapeTargetEggs();
      if (targetPrice) {
        sources.push({ source: 'Target', price: targetPrice, reliability: 0.82 });
      }
    } catch (error) {
      this.logger.warn('Target eggs scraping failed:', error.message);
    }

    return sources;
  }

  async collectMilkPrices() {
    const sources = [];

    // Source 1: USDA NASS API
    try {
      const usdaPrice = await this.getUsdaMilkPrice();
      if (usdaPrice) {
        sources.push({ source: 'USDA', price: usdaPrice, reliability: 0.95 });
      }
    } catch (error) {
      this.logger.warn('USDA milk price failed:', error.message);
    }

    // Source 2: Scrape retail prices
    try {
      const retailPrice = await this.scrapeRetailMilkPrice();
      if (retailPrice) {
        sources.push({ source: 'Retail Average', price: retailPrice, reliability: 0.85 });
      }
    } catch (error) {
      this.logger.warn('Retail milk scraping failed:', error.message);
    }

    return sources;
  }

  async collectGasPrices() {
    const sources = [];

    // Source 1: GasBuddy API (if available)
    try {
      if (process.env.GASBUDDY_API_KEY) {
        const gasBuddyPrice = await this.getGasBuddyPrice();
        if (gasBuddyPrice) {
          sources.push({ source: 'GasBuddy', price: gasBuddyPrice, reliability: 0.92 });
        }
      }
    } catch (error) {
      this.logger.warn('GasBuddy API failed:', error.message);
    }

    // Source 2: Scrape from AAA
    try {
      const aaaPrice = await this.scrapeAaaGasPrice();
      if (aaaPrice) {
        sources.push({ source: 'AAA', price: aaaPrice, reliability: 0.90 });
      }
    } catch (error) {
      this.logger.warn('AAA gas scraping failed:', error.message);
    }

    // Source 3: EIA API (Energy Information Administration)
    try {
      if (process.env.EIA_API_KEY) {
        const eiaPrice = await this.getEiaGasPrice();
        if (eiaPrice) {
          sources.push({ source: 'EIA', price: eiaPrice, reliability: 0.95 });
        }
      }
    } catch (error) {
      this.logger.warn('EIA API failed:', error.message);
    }

    return sources;
  }

  async collectCoffeePrices() {
    const sources = [];

    // Source 1: Commodities API
    try {
      if (process.env.COMMODITIES_API_KEY) {
        const commoditiesPrice = await this.getCommoditiesCoffeePrice();
        if (commoditiesPrice) {
          sources.push({ source: 'CommoditiesAPI', price: commoditiesPrice, reliability: 0.88 });
        }
      }
    } catch (error) {
      this.logger.warn('Commodities API failed:', error.message);
    }

    // Source 2: Scrape retail coffee prices
    try {
      const retailPrice = await this.scrapeRetailCoffeePrice();
      if (retailPrice) {
        sources.push({ source: 'Retail Average', price: retailPrice, reliability: 0.85 });
      }
    } catch (error) {
      this.logger.warn('Retail coffee scraping failed:', error.message);
    }

    return sources;
  }

  async getUsdaEggsPrice() {
    // USDA NASS QuickStats API
    const apiKey = process.env.USDA_API_KEY;
    if (!apiKey) return null;

    const response = await axios.get('https://quickstats.nass.usda.gov/api/api_GET/', {
      params: {
        key: apiKey,
        source_desc: 'SURVEY',
        sector_desc: 'ANIMALS & PRODUCTS',
        commodity_desc: 'EGGS',
        statisticcat_desc: 'PRICE RECEIVED',
        unit_desc: 'CENTS / DOZEN',
        freq_desc: 'MONTHLY',
        year: new Date().getFullYear(),
        format: 'JSON'
      },
      timeout: 10000
    });

    if (response.data && response.data.data && response.data.data.length > 0) {
      // Get the most recent price and convert cents to dollars
      const latestData = response.data.data[0];
      return parseFloat(latestData.Value) / 100;
    }

    return null;
  }

  async scrapeWalmartEggs() {
    // This is a simplified example - real implementation would need to handle 
    // anti-bot measures, product selection, and location-based pricing
    try {
      const response = await axios.get('https://www.walmart.com/search?q=eggs+dozen', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // This would need sophisticated parsing of Walmart's product data
      // For now, return a representative average
      return null;
    } catch (error) {
      return null;
    }
  }

  async scrapeTargetEggs() {
    // Similar to Walmart, this would need proper implementation
    return null;
  }

  async getUsdaMilkPrice() {
    const apiKey = process.env.USDA_API_KEY;
    if (!apiKey) return null;

    // Similar to eggs but for milk commodity data
    return null;
  }

  async scrapeRetailMilkPrice() {
    // Would scrape from multiple grocery store chains
    return null;
  }

  async getGasBuddyPrice() {
    // GasBuddy doesn't have a public API, so this would require scraping
    // For now, we'll use a placeholder
    return null;
  }

  async scrapeAaaGasPrice() {
    try {
      const response = await axios.get('https://gasprices.aaa.com/', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Look for national average gas price
      const priceElements = $('.gas-price, .price-value, [data-price]');
      
      for (let i = 0; i < priceElements.length; i++) {
        const element = $(priceElements[i]);
        const priceText = element.text().trim();
        const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
        
        if (price > 2 && price < 8) { // Reasonable gas price range
          return price;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async getEiaGasPrice() {
    const apiKey = process.env.EIA_API_KEY;
    if (!apiKey) return null;

    try {
      const response = await axios.get('https://api.eia.gov/v2/petroleum/pri/gnd/data/', {
        params: {
          api_key: apiKey,
          frequency: 'weekly',
          'data[]': 'value',
          'facets[product][]': 'EPM0',
          'facets[area][]': 'NUS',
          sort: '-period',
          length: 1
        },
        timeout: 10000
      });

      if (response.data && response.data.response && response.data.response.data.length > 0) {
        return response.data.response.data[0].value;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async getCommoditiesCoffeePrice() {
    // Would use commodity prices and convert to retail equivalent
    return null;
  }

  async scrapeRetailCoffeePrice() {
    // Would scrape coffee prices from major retailers
    return null;
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

    // Calculate weighted average
    let totalWeight = 0;
    let weightedSum = 0;
    
    sources.forEach(source => {
      totalWeight += source.reliability;
      weightedSum += source.price * source.reliability;
    });
    
    const weightedAverage = weightedSum / totalWeight;
    
    // Calculate variance
    const prices = sources.map(s => s.price);
    const mean = prices.reduce((a, b) => a + b) / prices.length;
    const variance = prices.reduce((acc, price) => acc + Math.pow(price - mean, 2), 0) / prices.length;
    const standardDeviation = Math.sqrt(variance);
    const coefficientOfVariation = standardDeviation / mean;
    
    // Consumer goods can have higher variance due to regional differences
    const verified = coefficientOfVariation < 0.15; // 15% threshold
    
    const primarySource = sources.sort((a, b) => b.reliability - a.reliability)[0];
    
    this.logger.info(`Consumer goods price verification: CV=${(coefficientOfVariation * 100).toFixed(2)}%, verified=${verified}`);
    
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
      symbols: Object.keys(this.goods).length
    };
  }
}

module.exports = ConsumerGoodsCollector;