#!/bin/bash

# Test script for Hyperliquid Node Trade Monitor

echo "Testing Hyperliquid Node Trade Monitor..."
echo "=========================================="

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Error: .env file not found. Creating from example..."
    cp env.example .env
    echo "Please configure .env file and run this script again."
    exit 1
fi

# Source .env file
export $(cat .env | grep -v '#' | xargs)

# Check if addresses are configured
if [ -z "$MONITOR_ADDRESSES" ]; then
    echo "Error: MONITOR_ADDRESSES not configured in .env file"
    exit 1
fi

# Check if data path exists
if [ ! -d "$NODE_DATA_PATH" ]; then
    echo "Error: NODE_DATA_PATH does not exist: $NODE_DATA_PATH"
    echo "Make sure your Hyperliquid node is running with --write-trades flag"
    exit 1
fi

echo "Configuration:"
echo "  Monitored Addresses: $MONITOR_ADDRESSES"
echo "  Data Path: $NODE_DATA_PATH"
echo "  Stats Interval: ${STATS_INTERVAL_MS:-300000}ms"
echo "  Port: ${PORT:-3002}"
echo ""

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build the application
echo "Building application..."
npm run build

# Start the application
echo "Starting application..."
echo "The monitor will log statistics every ${STATS_INTERVAL_MS:-300000}ms"
echo "Press Ctrl+C to stop"
echo ""

npm run start:prod
