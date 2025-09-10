# Hyperliquid Order Benchmarking System

A comprehensive NestJS application for benchmarking Hyperliquid order placement performance, measuring latency, success rates, and comparing different order types and transport mechanisms.

## Features

- **Multiple Order Types**: Market (IOC), Limit (GTC), and Post-Only (ALO) orders
- **Transport Comparison**: HTTP vs WebSocket performance analysis
- **Real-time Monitoring**: WebSocket subscriptions for immediate fill notifications
- **Comprehensive Metrics**: Detailed latency analysis with percentiles (P50, P95, P99)
- **Error Handling**: Robust error categorization and failure recovery
- **Clean Architecture**: Modular services with clear separation of concerns

## Setup

1. **Install Dependencies**
```bash
npm install
```

2. **Environment Configuration**
Create a `.env` file with your Hyperliquid credentials:
```env
# Required: Hyperliquid API Configuration
ORDER_PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
ORDER_PUBLIC_KEY=0xabcdef1234567890abcdef1234567890abcdef12

# Optional: Auto-run benchmarks on startup
BENCHMARK_AUTO_RUN=false
BENCHMARK_EXIT_AFTER=true

# Optional: Default benchmark parameters (when auto-run is enabled)
BENCHMARK_SYMBOL=ETH
BENCHMARK_ORDER_TYPE=market
BENCHMARK_TRANSPORT=http
BENCHMARK_ORDER_SIZE=0.001
BENCHMARK_ORDER_COUNT=5
BENCHMARK_DELAY=1000
BENCHMARK_TIMEOUT=30000
```

3. **Start the Application**
```bash
# Start as web server (default)
npm run start:dev

# Or run benchmark directly and exit
npm run benchmark
```

## Running Benchmarks

You can run benchmarks in two ways: **directly via command line** or **through HTTP API endpoints**.

### Direct Benchmark Execution

Run benchmarks directly when starting the application (no HTTP server needed):

#### Quick Benchmark Commands
```bash
# Run default benchmark (5 market orders via HTTP)
npm run benchmark

# Quick 5-order test
npm run benchmark:quick

# Test specific order types
npm run benchmark:market    # Market orders (IOC)
npm run benchmark:limit     # Limit orders (GTC) 
npm run benchmark:websocket # Via WebSocket transport

# Compare performance (runs HTTP then WebSocket)
npm run benchmark:compare
```

#### Custom Configuration via Environment Variables
```bash
# Set custom parameters in .env file
BENCHMARK_AUTO_RUN=true
BENCHMARK_SYMBOL=BTC
BENCHMARK_ORDER_COUNT=10
BENCHMARK_ORDER_SIZE=0.002
npm start
```

#### Command Line Arguments
Override any setting using command line arguments:
```bash
# Custom symbol and order count
BENCHMARK_AUTO_RUN=true npm start -- --symbol BTC --count 10

# Test WebSocket with custom delay
BENCHMARK_AUTO_RUN=true npm start -- --transport websocket --delay 2000 --size 0.005

# Limit orders with price offset
BENCHMARK_AUTO_RUN=true npm start -- --orderType limit --offset 1.0 --count 3
```

**Available Command Line Options:**
- `--symbol` : Trading symbol (default: ETH)
- `--orderType` : market, limit, post-only (default: market)
- `--transport` : http, websocket (default: http)
- `--size` : Order size (default: 0.001)
- `--count` : Number of orders (default: 5)
- `--delay` : Delay between orders in ms (default: 1000)
- `--timeout` : Order timeout in ms (default: 30000)
- `--offset` : Price offset for limit orders

#### Environment Variables Reference
```bash
BENCHMARK_AUTO_RUN=true          # Enable auto-run on startup
BENCHMARK_EXIT_AFTER=true        # Exit after benchmark completes
BENCHMARK_SYMBOL=ETH             # Trading symbol
BENCHMARK_ORDER_TYPE=market      # Order type: market, limit, post_only
BENCHMARK_TRANSPORT=http         # Transport: http, websocket
BENCHMARK_ORDER_SIZE=0.001       # Size per order
BENCHMARK_ORDER_COUNT=5          # Number of orders to place
BENCHMARK_DELAY=1000            # Delay between orders (ms)
BENCHMARK_TIMEOUT=30000         # Max time to wait for fills (ms)
```

## API Endpoints

For programmatic access, use the HTTP API endpoints:

### Run Custom Benchmark
```http
POST /benchmark/run
Content-Type: application/json

{
  "symbol": "ETH",
  "orderType": "market",
  "transportType": "http",
  "orderSize": 0.001,
  "numberOfOrders": 10,
  "delayBetweenOrders": 1000,
  "maxOrderTimeout": 30000,
  "priceOffset": 0.5
}
```

### Quick Benchmark
```http
POST /benchmark/quick?orderType=market&transportType=http&numberOfOrders=5
```

### Compare Transport Types
```http
POST /benchmark/compare-transports
Content-Type: application/json

{
  "symbol": "ETH",
  "orderType": "market",
  "orderSize": 0.001,
  "numberOfOrders": 10,
  "delayBetweenOrders": 1000,
  "maxOrderTimeout": 30000
}
```

### Check Benchmark Status
```http
GET /benchmark/status
```

### Get Default Configuration
```http
GET /benchmark/default-config
```

## Order Types

### Market Orders (IOC - Immediate or Cancel)
- Fastest execution with aggressive pricing
- Uses slightly worse prices to ensure immediate fills
- Best for measuring minimum latency

### Limit Orders (GTC - Good Till Canceled)
- Standard limit orders at specified prices
- May require waiting for market to reach your price
- Good for measuring fill latency under normal conditions

### Post-Only Orders (ALO - Add Liquidity Only)
- Guaranteed to add liquidity to the order book
- Will be rejected if they would immediately match
- Best for measuring order placement latency without fills

## Metrics Measured

### Timing Metrics
- **Send-to-Return Latency**: Time from sending order request to receiving response
- **Send-to-Fill Latency**: Time from sending order to actual fill on-chain
- **Fill-to-Notification Latency**: Time from fill to WebSocket notification
- **Return-to-Fill Latency**: Time from response to actual fill

### Statistical Analysis
- Average, minimum, maximum latencies
- P50, P95, P99 percentiles for latency distribution
- Success rates and error categorization
- Price slippage analysis

### Performance Comparison
- HTTP vs WebSocket transport performance
- Different order type execution characteristics
- Error pattern analysis

## Architecture

### Services

#### OrderService
- Handles all Hyperliquid API interactions
- Manages both HTTP and WebSocket clients
- Provides order placement methods for all order types
- Real-time fill monitoring via WebSocket subscriptions

#### BenchService
- Orchestrates benchmark execution
- Collects and analyzes performance metrics
- Generates comprehensive reports
- Handles error recovery and timeout management

### Data Structures
- Clean interfaces for all benchmark configurations
- Comprehensive result types with statistical analysis
- Error categorization and performance tracking

## Usage Examples

### Quick Start Examples

#### Shell Script (Easiest)
```bash
# Make executable and run quick test
chmod +x run-benchmark.sh
./run-benchmark.sh

# Various predefined benchmarks
./run-benchmark.sh market --count 10        # 10 market orders
./run-benchmark.sh websocket --symbol BTC   # BTC via WebSocket
./run-benchmark.sh compare                  # HTTP vs WebSocket comparison
./run-benchmark.sh limit --offset 1.0       # Limit orders with price offset
./run-benchmark.sh stress                   # High-frequency stress test

# Custom configuration
./run-benchmark.sh custom --symbol SOL --count 15 --delay 800
```

#### Direct NPM Execution
```bash
# Simple 5-order market test
npm run benchmark

# Test WebSocket performance
npm run benchmark:websocket

# Custom 10-order BTC test with 2s delays
BENCHMARK_AUTO_RUN=true npm start -- --symbol BTC --count 10 --delay 2000

# Limit orders with $1 price offset
BENCHMARK_AUTO_RUN=true npm start -- --orderType limit --offset 1.0 --count 3
```

#### HTTP API Examples
```bash
# Start server first
npm run start:dev

# Basic market order benchmark (10 orders)
curl -X POST http://localhost:3000/benchmark/quick?orderType=market&numberOfOrders=10

# Compare transport performance
curl -X POST http://localhost:3000/benchmark/compare-transports \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "ETH",
    "orderType": "market",
    "orderSize": 0.001,
    "numberOfOrders": 5,
    "delayBetweenOrders": 2000,
    "maxOrderTimeout": 30000
  }'

# Custom limit order test
curl -X POST http://localhost:3000/benchmark/run \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "ETH",
    "orderType": "limit",
    "transportType": "websocket",
    "orderSize": 0.001,
    "numberOfOrders": 5,
    "priceOffset": 1.0,
    "delayBetweenOrders": 3000,
    "maxOrderTimeout": 60000
  }'
```

### Advanced Examples

#### Performance Comparison Workflow
```bash
# Test both transports automatically
npm run benchmark:compare

# Or manually with custom config
BENCHMARK_AUTO_RUN=true npm start -- --transport http --count 10 --symbol BTC
BENCHMARK_AUTO_RUN=true npm start -- --transport websocket --count 10 --symbol BTC
```

#### Custom Configuration Testing
```bash
# High-frequency testing (careful with API limits!)
BENCHMARK_AUTO_RUN=true npm start -- --count 20 --delay 500 --size 0.0005

# Stress test with timeouts
BENCHMARK_AUTO_RUN=true npm start -- --count 50 --delay 200 --timeout 10000
```

## Quick Reference

### Fastest Way to Start
```bash
# 1. Set your API keys in .env file
# 2. Run the benchmark script (recommended)
./run-benchmark.sh

# Or use npm commands directly
npm run benchmark

# With custom parameters
./run-benchmark.sh market --count 10 --delay 500
```

### Common Use Cases
- **Quick Performance Test**: `./run-benchmark.sh` or `npm run benchmark:quick`
- **Compare Transports**: `./run-benchmark.sh compare` or `npm run benchmark:compare` 
- **Test WebSocket Only**: `./run-benchmark.sh websocket` or `npm run benchmark:websocket`
- **Custom Configuration**: `./run-benchmark.sh custom --count 10 --symbol BTC`
- **Stress Testing**: `./run-benchmark.sh stress`
- **HTTP API Access**: Start server with `npm run start:dev` then use curl/Postman

## Important Notes

- **Test Environment**: Use small order sizes and limited quantities for testing
- **Rate Limits**: The system includes delays between orders to respect API limits
- **Error Handling**: Failed orders are tracked and categorized for analysis
- **Real Money**: This system places actual orders on Hyperliquid - use appropriate precautions
- **WebSocket Reliability**: Real-time fill notifications depend on stable WebSocket connections
- **Auto-Exit**: When using `BENCHMARK_EXIT_AFTER=true`, the application will terminate after benchmarks complete

## Security

- Private keys should be stored securely in environment variables
- Never commit private keys to version control
- Use separate test accounts for benchmarking
- Monitor your positions and balances regularly

## Support

For issues related to:
- Hyperliquid API: Check official Hyperliquid documentation
- NestJS Framework: Refer to NestJS documentation
- TypeScript: Consult TypeScript documentation