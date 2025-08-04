const axios = require('axios');
const cheerio = require('cheerio');

class RealEstateCollector {
  constructor(logger) {
    this.logger = logger;
    this.name = 'Real Estate Collector';
    
    // Real estate metrics we track
    this.properties = {
      'HOUSE-US': { name: 'US Median House Price', region: 'US', type: 'median_home_price' },
      'HOUSE-CA': { name: 'Canada Median House Price', region: 'CA', type: 'median_home_price' },
      'NYC-SQFT': { name: 'NYC Price per sqft', region: 'NYC', type: 'price_per_sqft' }
    };
    
    this.lastUpdate = 0;
    this.status = 'initialized';
  }

  async collectData() {
    this.status = 'collecting';
    const results = [];
    
    try {
      // Collect data for each real estate metric
      for (const symbol of Object.keys(this.properties)) {
        const result = await this.collectRealEstatePrice(symbol);
        results.push(result);
      }
      
      this.lastUpdate = Date.now();
      this.status = 'completed';
      
    } catch (error) {
      this.logger.error('Real estate collection failed:', error);
      this.status = 'error';
    }
    
    return results;
  }

  async collectRealEstatePrice(symbol) {
    const sources = [];
    const property = this.properties[symbol];
    
    try {
      // Different strategies based on region and type
      switch (symbol) {
        case 'HOUSE-US':
          sources.push(...await this.collectUSHousingPrices());
          break;
        case 'HOUSE-CA':
          sources.push(...await this.collectCanadaHousingPrices());
          break;
        case 'NYC-SQFT':
          sources.push(...await this.collectNYCPricesPerSqft());
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

  async collectUSHousingPrices() {
    const sources = [];

    // Source 1: FRED API (Federal Reserve Economic Data)
    try {
      if (process.env.FRED_API_KEY) {
        const fredPrice = await this.getFredHousingPrice();
        if (fredPrice) {
          sources.push({ source: 'FRED', price: fredPrice, reliability: 0.95 });
        }
      }
    } catch (error) {
      this.logger.warn('FRED API failed:', error.message);
    }

    // Source 2: Zillow Research Data
    try {
      const zillowPrice = await this.getZillowResearchData();
      if (zillowPrice) {
        sources.push({ source: 'Zillow Research', price: zillowPrice, reliability: 0.90 });
      }
    } catch (error) {
      this.logger.warn('Zillow Research failed:', error.message);
    }

    // Source 3: Redfin Data Center
    try {
      const redfinPrice = await this.getRedfinData();
      if (redfinPrice) {
        sources.push({ source: 'Redfin', price: redfinPrice, reliability: 0.88 });
      }
    } catch (error) {
      this.logger.warn('Redfin data failed:', error.message);
    }

    // Source 4: NAR (National Association of Realtors)
    try {
      const narPrice = await this.scrapeNarData();
      if (narPrice) {
        sources.push({ source: 'NAR', price: narPrice, reliability: 0.92 });
      }
    } catch (error) {
      this.logger.warn('NAR scraping failed:', error.message);
    }

    return sources;
  }

  async collectCanadaHousingPrices() {
    const sources = [];

    // Source 1: Statistics Canada
    try {
      const statCanPrice = await this.getStatCanHousingPrice();
      if (statCanPrice) {
        sources.push({ source: 'Statistics Canada', price: statCanPrice, reliability: 0.95 });
      }
    } catch (error) {
      this.logger.warn('Statistics Canada failed:', error.message);
    }

    // Source 2: CREA (Canadian Real Estate Association)
    try {
      const creaPrice = await this.scrapeCreaData();
      if (creaPrice) {
        sources.push({ source: 'CREA', price: creaPrice, reliability: 0.90 });
      }
    } catch (error) {
      this.logger.warn('CREA scraping failed:', error.message);
    }

    return sources;
  }

  async collectNYCPricesPerSqft() {
    const sources = [];

    // Source 1: NYC Open Data
    try {
      const nycOpenDataPrice = await this.getNycOpenDataPrice();
      if (nycOpenDataPrice) {
        sources.push({ source: 'NYC Open Data', price: nycOpenDataPrice, reliability: 0.92 });
      }
    } catch (error) {
      this.logger.warn('NYC Open Data failed:', error.message);
    }

    // Source 2: StreetEasy Market Data
    try {
      const streetEasyPrice = await this.scrapeStreetEasyData();
      if (streetEasyPrice) {
        sources.push({ source: 'StreetEasy', price: streetEasyPrice, reliability: 0.88 });
      }
    } catch (error) {
      this.logger.warn('StreetEasy scraping failed:', error.message);
    }

    return sources;
  }

  async getFredHousingPrice() {
    // FRED API for median home sale price (MSPUS)
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) return null;

    try {
      const response = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
        params: {
          series_id: 'MSPUS', // Median Sales Price of Houses Sold for the United States
          api_key: apiKey,
          file_type: 'json',
          limit: 1,
          sort_order: 'desc'
        },
        timeout: 10000
      });

      if (response.data && response.data.observations && response.data.observations.length > 0) {
        const latestData = response.data.observations[0];
        return parseFloat(latestData.value);
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async getZillowResearchData() {
    // Note: Zillow's API was discontinued, but they provide research data
    // This would require scraping their research pages or using alternative sources
    try {
      const response = await axios.get('https://www.zillow.com/research/data/', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // This would need sophisticated parsing of Zillow's research data
      // For now, return null as placeholder
      return null;
    } catch (error) {
      return null;
    }
  }

  async getRedfinData() {
    // Redfin Data Center provides market data
    try {
      const response = await axios.get('https://www.redfin.com/news/data-center/', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Look for median price data
      const priceElements = $('.metric-value, [data-metric="median-price"]');
      
      for (let i = 0; i < priceElements.length; i++) {
        const element = $(priceElements[i]);
        const priceText = element.text().trim();
        const price = parseFloat(priceText.replace(/[^0-9]/g, ''));
        
        // Reasonable range for US median home prices
        if (price > 200000 && price < 1000000) {
          return price;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async scrapeNarData() {
    // National Association of Realtors data
    try {
      const response = await axios.get('https://www.nar.realtor/research-and-statistics', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // This would need specific parsing for NAR's data format
      return null;
    } catch (error) {
      return null;
    }
  }

  async getStatCanHousingPrice() {
    // Statistics Canada housing price index
    try {
      const response = await axios.get('https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810020501', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // This would need specific parsing for Statistics Canada's format
      return null;
    } catch (error) {
      return null;
    }
  }

  async scrapeCreaData() {
    // Canadian Real Estate Association data
    try {
      const response = await axios.get('https://www.crea.ca/housing-market-stats/', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Look for average/median price data
      const priceElements = $('.price-stat, .average-price, [data-price]');
      
      for (let i = 0; i < priceElements.length; i++) {
        const element = $(priceElements[i]);
        const priceText = element.text().trim();
        const price = parseFloat(priceText.replace(/[^0-9]/g, ''));
        
        // Reasonable range for Canadian home prices
        if (price > 400000 && price < 2000000) {
          return price;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async getNycOpenDataPrice() {
    // NYC Open Data for real estate transactions
    try {
      const response = await axios.get('https://data.cityofnewyork.us/resource/bc8t-ecyu.json', {
        params: {
          '$limit': 1000,
          '$order': 'sale_date DESC',
          'borough': 'MANHATTAN'
        },
        timeout: 15000
      });

      if (response.data && response.data.length > 0) {
        // Calculate median price per square foot from recent sales
        const validSales = response.data
          .filter(sale => sale.sale_price && sale.gross_square_feet && 
                         parseFloat(sale.sale_price) > 100000 && 
                         parseFloat(sale.gross_square_feet) > 100)
          .map(sale => parseFloat(sale.sale_price) / parseFloat(sale.gross_square_feet))
          .sort((a, b) => a - b);

        if (validSales.length > 10) {
          // Return median price per sqft
          return validSales[Math.floor(validSales.length / 2)];
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async scrapeStreetEasyData() {
    // StreetEasy market data for NYC
    try {
      const response = await axios.get('https://streeteasy.com/blog/data-dashboard/', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Look for price per square foot data
      const priceElements = $('.price-per-sqft, [data-metric="price-per-sqft"]');
      
      for (let i = 0; i < priceElements.length; i++) {
        const element = $(priceElements[i]);
        const priceText = element.text().trim();
        const price = parseFloat(priceText.replace(/[^0-9]/g, ''));
        
        // Reasonable range for NYC price per sqft
        if (price > 500 && price < 5000) {
          return price;
        }
      }

      return null;
    } catch (error) {
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
    
    // Real estate can have some variance due to timing and methodology
    const verified = coefficientOfVariation < 0.10; // 10% threshold
    
    const primarySource = sources.sort((a, b) => b.reliability - a.reliability)[0];
    
    this.logger.info(`Real estate price verification: CV=${(coefficientOfVariation * 100).toFixed(2)}%, verified=${verified}`);
    
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
      symbols: Object.keys(this.properties).length
    };
  }
}

module.exports = RealEstateCollector;