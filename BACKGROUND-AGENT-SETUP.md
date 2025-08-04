# Universal Price Tracker - Background Agent Setup Guide

This guide will help you set up a robust background agent that automatically collects accurate price data from multiple sources with cross-verification.

## 🚀 What This System Does

- **Real Data Collection**: Scrapes and fetches actual market data from reliable sources
- **Multi-Source Verification**: Cross-references prices from multiple sources for accuracy
- **Automatic Scheduling**: Updates prices regularly based on market hours
- **Data Validation**: Flags suspicious data and calculates confidence levels
- **Historical Storage**: Maintains long-term price history
- **API Server**: Serves clean data to your frontend application

## 📋 Prerequisites

- Node.js 16 or higher
- NPM or Yarn package manager
- Basic understanding of APIs and environment variables

## 🛠️ Installation

### Step 1: Install Dependencies

```bash
# Install all required packages
npm install

# Or if you prefer yarn
yarn install
```

### Step 2: Set Up Environment Variables

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit the `.env` file and add your API keys (see API Keys section below)

### Step 3: Create Required Directories

```bash
# Create directories for data and logs
mkdir -p data logs
```

## 🔑 API Keys Setup

To get the most accurate data, you'll need several API keys. **Don't worry** - many of these are free!

### Free APIs (Recommended to start with):

1. **CoinGecko** (Crypto) - No API key needed, built-in rate limiting
2. **Alpha Vantage** (Stocks) - Free tier: 5 calls/minute, 500 calls/day
   - Get at: https://www.alphavantage.co/support/#api-key
3. **FRED** (Real Estate) - Free, unlimited for public data
   - Get at: https://fred.stlouisfed.org/docs/api/api_key.html
4. **USDA NASS** (Food prices) - Free government data
   - Get at: https://quickstats.nass.usda.gov/api
5. **EIA** (Energy prices) - Free government data
   - Get at: https://www.eia.gov/opendata/

### Premium APIs (Optional, for more accuracy):

6. **CoinMarketCap** (Crypto) - Enhanced crypto data
   - Get at: https://coinmarketcap.com/api/
7. **Financial Modeling Prep** (Stocks/Metals) - More comprehensive data
   - Get at: https://financialmodelingprep.com/developer/docs
8. **Metals-API** (Precious Metals) - Specialized metals pricing
   - Get at: https://metals-api.com/

## 🚀 Running the Background Agent

### Development Mode (with auto-restart):
```bash
npm run dev
```

### Production Mode:
```bash
npm start
```

### Check if it's working:
Visit `http://localhost:3001/api/status` in your browser

## 🔧 Configuration

### Update Intervals
The system automatically adjusts update frequency:
- **Market Hours (6 AM - 10 PM)**: Every 5 minutes
- **Off Hours**: Every 60 minutes
- **Manual Updates**: Available via API endpoint

### Data Verification
Each price point includes:
- **Source**: Which website/API provided the data
- **Verified**: Whether multiple sources agree (< 2% variance)
- **Variance**: How much sources disagree (lower = more reliable)

## 📡 API Endpoints

Your frontend can access data through these endpoints:

### Get Current Prices
```
GET /api/prices
```
Returns all current prices with metadata

### Get Historical Data
```
GET /api/historical/BTC?period=1W
```
Available periods: 1H, 1D, 1W, 1M, 3M, 1Y

### System Status
```
GET /api/status
```
Shows system health and collector status

### Manual Update
```
POST /api/update
```
Triggers immediate data collection

## 🔄 Integrating with Your Frontend

Update your existing frontend to use real data instead of simulated:

```javascript
// Replace the simulated updateItemPrice function
async function updateItemPrice(item) {
    try {
        const response = await fetch('http://localhost:3001/api/prices');
        const data = await response.json();
        
        if (data.prices[item.symbol]) {
            currentPrices[item.symbol] = data.prices[item.symbol];
            addDataPoint(item.symbol, data.prices[item.symbol]);
        }
    } catch (error) {
        console.error('Failed to fetch real price data:', error);
        // Fallback to simulated data if needed
    }
}
```

## 📊 Data Categories Collected

### Cryptocurrencies
- Bitcoin (BTC) - CoinGecko, Binance, CoinMarketCap
- Ethereum (ETH) - Multiple exchanges
- Solana (SOL) - Cross-referenced prices
- Dogecoin (DOGE) - Verified across platforms

### Precious Metals
- Gold (XAU) - APMEX, GoldPrice.org, MetalsAPI
- Silver (XAG) - Multiple dealers and APIs
- Platinum (XPT) - Professional sources
- Palladium (XPD) - Market data aggregation

### Stock Indices
- S&P 500 (SPY) - Yahoo Finance, MarketWatch, APIs
- NASDAQ (QQQ) - Multiple financial sources
- Dow Jones (DIA) - Cross-verified data

### Consumer Goods
- Eggs - USDA official data + retail scraping
- Milk - Government sources + market data
- Gas - AAA, EIA official data
- Coffee - Commodity prices + retail

### Luxury Items
- Rolex watches - Chrono24, auction data
- Trading cards - eBay sold listings, auction houses
- Collectibles - Market-specific sources

### Real Estate
- US median home price - FRED, Zillow, Redfin
- Canada housing - Statistics Canada, CREA
- NYC price/sqft - NYC Open Data, StreetEasy

## 🛡️ Data Quality & Accuracy

The system implements multiple layers of verification:

1. **Source Reliability Scoring**: Each source has a reliability weight
2. **Variance Detection**: Flags when sources disagree significantly
3. **Sanity Checks**: Rejects prices outside reasonable ranges
4. **Weighted Averaging**: Combines sources based on reliability
5. **Historical Consistency**: Detects sudden unrealistic changes

## 🔍 Monitoring & Troubleshooting

### Check System Status
```bash
# View real-time logs
tail -f logs/combined.log

# Check for errors
tail -f logs/error.log
```

### Common Issues:

1. **No data collecting**: Check API keys in `.env` file
2. **High variance warnings**: Normal for some asset classes (collectibles)
3. **Rate limiting**: Some free APIs have usage limits
4. **Network timeouts**: Increase timeout values in collectors

## 🚦 Production Deployment

### Using PM2 (Recommended):
```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start background-agent.js --name "price-tracker-agent"

# Set up auto-start on server reboot
pm2 startup
pm2 save
```

### Using Docker:
```dockerfile
# Dockerfile example
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

## 📈 Performance Optimization

- **Parallel Collection**: All collectors run simultaneously
- **Intelligent Caching**: Reduces redundant API calls
- **Market Hours Awareness**: More frequent updates when markets are active
- **Error Recovery**: Continues operation even if some sources fail

## 🎯 Next Steps

1. **Start with free APIs** to test the system
2. **Monitor data quality** through the status endpoint
3. **Gradually add premium APIs** for enhanced accuracy
4. **Customize collectors** for additional data sources
5. **Set up monitoring** for production use

## 🆘 Support & Troubleshooting

If you run into issues:

1. Check the logs in the `logs/` directory
2. Verify API keys are correctly set in `.env`
3. Test individual collectors by checking `/api/status`
4. Ensure network connectivity to external APIs
5. Check rate limits on your API keys

## 🎉 You're All Set!

Your background agent will now:
- ✅ Collect real market data automatically
- ✅ Verify accuracy across multiple sources
- ✅ Store historical data for trend analysis
- ✅ Serve clean, reliable data to your frontend
- ✅ Flag any suspicious or unverified data points

The system is designed to be **beginner-friendly** while providing **professional-grade** data accuracy. Start with the free APIs and expand as needed!