# Hyperliquid Node Trade Monitor

A high-performance NestJS application that monitors trades from a local Hyperliquid non-validator node in real-time, providing ultra-low latency detection of trade executions.

## Overview

This application connects directly to the trade log files written by your local Hyperliquid node, using efficient file system monitoring to detect new trades as soon as they're written to disk. This approach bypasses the public API and WebSocket delays, providing the fastest possible trade detection.

## Features

- **Real-time Trade Monitoring**: Uses chokidar for efficient file system monitoring
- **Low Latency Detection**: Directly reads from node's trade log files
- **Address Filtering**: Monitor specific Hyperliquid addresses
- **Latency Statistics**: Tracks and reports detection latency metrics
- **REST API**: Provides endpoints to query recent trades and statistics
- **Automatic Log Rotation**: Handles hourly log file rotations seamlessly

## Prerequisites

- Node.js v18+ and npm
- Running Hyperliquid non-validator node with `--write-trades` flag
- Access to the node's data directory (default: `~/hl/data/node_trades/hourly`)

## Installation

1. Clone the repository and navigate to the node directory:
```bash
cd /home/awang/tmp/hyper/node
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on the example:
```bash
cp env.example .env
```

4. Configure the `.env` file with your settings:
```env
# Hyperliquid addresses to monitor (comma-separated)
MONITOR_ADDRESSES=0x1234567890abcdef...,0xabcdef1234567890...

# Path to the node data directory
NODE_DATA_PATH=/home/awang/hl/data/node_trades/hourly

# Interval for logging statistics (in milliseconds)
STATS_INTERVAL_MS=300000

# Maximum number of trade records to keep in memory
MAX_RECORDS_TO_KEEP=1000

# Port for the NestJS application
PORT=3002
```

## Running the Application

### Development Mode
```bash
npm run start:dev
```

### Production Mode
```bash
npm run build
npm run start:prod
```

## API Endpoints

### GET /
Returns a simple health check message.

### GET /trades/recent?limit=10
Returns the most recent trades for monitored addresses.

**Response:**
```json
{
  "trades": [
    {
      "trade": {
        "coin": "ETH",
        "side": "B",
        "time": "2025-09-10T05:59:59.941651384",
        "px": "4428.1",
        "sz": "0.01",
        "hash": "0x...",
        "trade_dir_override": "Na",
        "side_info": [...]
      },
      "detectedAt": 1694325599950,
      "tradeTimestamp": 1694325599941,
      "detectionLatency": 9
    }
  ],
  "totalCount": 156
}
```

### GET /trades/stats
Returns latency statistics for all recorded trades.

**Response:**
```json
{
  "latencyStats": {
    "min": 5,
    "max": 25,
    "avg": 12.5,
    "p50": 11,
    "p95": 20,
    "p99": 24,
    "count": 156
  },
  "totalTrades": 156
}
```

## How It Works

1. **Current Hour Monitoring**: The application monitors only the current hour's trade file (e.g., `20250910/16` for hour 16), avoiding historical data processing.

2. **Automatic Hour Rotation**: Every minute, it checks if the hour has changed and automatically switches to monitoring the new hour's file.

3. **Efficient Reading**: When new data is detected, it reads only the new content using streams and tracks file positions to avoid re-reading.

4. **Trade Parsing**: Each line in the trade files is parsed as JSON and checked against the monitored addresses. Old trades (>1 hour) are automatically filtered out.

5. **Latency Calculation**: For matching trades, it calculates the detection latency as `current_time - trade_time`.

6. **Statistics**: Every 5 minutes (configurable), it logs comprehensive statistics about detection performance.

## Performance Considerations

- **Memory Efficient**: Uses streams for file reading and maintains a limited buffer of trade records
- **CPU Efficient**: Only processes new data and filters trades early
- **Low Latency**: Direct file system monitoring provides the fastest possible detection

## Monitoring Output

The application logs detailed statistics every 5 minutes:

```
================================================================================
TRADE MONITORING STATISTICS
================================================================================
Total trades recorded: 156

LATENCY STATISTICS (Detection time - Trade time):
  Min: 5ms
  Max: 25ms
  Average: 12.50ms
  P50: 11ms
  P95: 20ms
  P99: 24ms

LAST 10 TRADES:
  1. 2025-09-10T05:59:59.941Z - ETH BUY 0.01 @ 4428.1 (user: 0x1234abcd..., latency: 9ms)
  2. 2025-09-10T06:01:23.456Z - BTC SELL 0.001 @ 98765.4 (user: 0x1234abcd..., latency: 11ms)
  ...
================================================================================
```

## Troubleshooting

1. **No trades detected**: 
   - Verify the NODE_DATA_PATH is correct
   - Ensure your node is running with `--write-trades` flag
   - Check that MONITOR_ADDRESSES contains valid addresses

2. **High latencies**:
   - Check system load and disk I/O
   - Ensure the application is running on the same machine as the node
   - Consider reducing STATS_INTERVAL_MS if needed

3. **Missing trades**:
   - Verify the monitored addresses are correct
   - Check application logs for parsing errors
   - Ensure file permissions allow reading the trade files

## Architecture

The application follows a modular NestJS architecture:

- **MonitorService**: Core service handling file monitoring and trade processing
- **AppController**: REST API endpoints
- **ConfigModule**: Environment configuration management
- **ScheduleModule**: Periodic statistics reporting

## License

This project is private and proprietary.