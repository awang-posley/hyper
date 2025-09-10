#!/bin/bash

# ==============================================================================
# Hyperliquid Order Benchmark Runner
# ==============================================================================
# This script provides an easy way to run various benchmark configurations
# for testing Hyperliquid order placement performance.
#
# Usage: ./run-benchmark.sh [BENCHMARK_TYPE] [OPTIONS]
#
# BENCHMARK TYPES:
#   quick           - Quick 5-order market test (default)
#   market          - Market orders via HTTP
#   websocket       - Market orders via WebSocket
#   limit           - Limit orders test
#   post-only       - Post-only orders test
#   post-only-cancel - Post-only orders + cancel latency test
#   compare         - HTTP vs WebSocket comparison
#   stress          - High-frequency stress test
#   custom          - Use environment variables or CLI args
#
# OPTIONS:
#   --symbol SYMBOL     - Trading symbol (default: ETH)
#   --count NUMBER      - Number of orders (default: 5)
#   --size NUMBER       - Order size (default: 0.001)
#   --delay MS          - Delay between orders in ms (default: 1000)
#   --timeout MS        - Order timeout in ms (default: 30000)
#   --offset NUMBER     - Price offset for limit orders
#   --transport TYPE    - Transport type: http|websocket (default: http)
#   --no-exit          - Don't exit after benchmark (keep server running)
#   --help             - Show this help message
#
# ENVIRONMENT VARIABLES:
# All benchmark behavior can be controlled via environment variables:
#
#   BENCHMARK_AUTO_RUN=true          # Enable auto-run on startup
#   BENCHMARK_EXIT_AFTER=true        # Exit after benchmark completes
#   BENCHMARK_SYMBOL=ETH             # Trading symbol (ETH, BTC, SOL, etc.)
#   BENCHMARK_ORDER_TYPE=market      # Order type: market, limit, post_only
#   BENCHMARK_TRANSPORT=http         # Transport: http, websocket
#   BENCHMARK_ORDER_SIZE=0.001       # Size per order
#   BENCHMARK_ORDER_COUNT=5          # Number of orders to place
#   BENCHMARK_DELAY=1000            # Delay between orders (ms)
#   BENCHMARK_TIMEOUT=30000         # Max time to wait for fills (ms)
#
# EXAMPLES:
#   ./run-benchmark.sh                              # Quick default test
#   ./run-benchmark.sh market --count 10           # 10 market orders
#   ./run-benchmark.sh websocket --symbol BTC      # BTC via WebSocket
#   ./run-benchmark.sh limit --offset 1.0          # Limit orders with $1 offset
#   ./run-benchmark.sh compare                     # HTTP vs WebSocket comparison
#   ./run-benchmark.sh stress                      # High-frequency test
#   ./run-benchmark.sh custom --count 20 --delay 500  # Custom configuration
#
# REQUIREMENTS:
#   - Node.js and npm installed
#   - .env file with ORDER_PRIVATE_KEY and ORDER_PUBLIC_KEY set
#   - npm dependencies installed (npm install)
#
# ==============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
DEFAULT_SYMBOL="ETH"
DEFAULT_COUNT=10
DEFAULT_SIZE="0.01"
DEFAULT_DELAY=1000
DEFAULT_TIMEOUT=30000
DEFAULT_TRANSPORT="http"
DEFAULT_EXIT_AFTER="true"

# Parse command line arguments
BENCHMARK_TYPE="quick"
SYMBOL=""
COUNT=""
SIZE=""
DELAY=""
TIMEOUT=""
OFFSET=""
TRANSPORT=""
EXIT_AFTER=""

show_help() {
    echo "Hyperliquid Order Benchmark Runner"
    echo ""
    echo "Usage: $0 [BENCHMARK_TYPE] [OPTIONS]"
    echo ""
    echo "BENCHMARK TYPES:"
    echo "  quick           Quick 10-order market test (default)"
    echo "  market          Market orders via HTTP"
    echo "  websocket       Market orders via WebSocket"
    echo "  limit           Limit orders test"
    echo "  post-only       Post-only orders test"
    echo "  post-only-cancel Post-only orders + cancel latency test"
    echo "  compare         HTTP vs WebSocket comparison"
    echo "  stress          High-frequency stress test"
    echo "  custom          Use custom parameters"
    echo ""
    echo "OPTIONS:"
    echo "  --symbol SYMBOL     Trading symbol (default: ETH)"
    echo "  --count NUMBER      Number of orders (default: 5)"
    echo "  --size NUMBER       Order size (default: 0.001)"
    echo "  --delay MS          Delay between orders in ms (default: 1000)"
    echo "  --timeout MS        Order timeout in ms (default: 30000)"
    echo "  --offset NUMBER     Price offset for limit orders"
    echo "  --transport TYPE    Transport type: http|websocket (default: http)"
    echo "  --no-exit          Don't exit after benchmark"
    echo "  --help             Show this help"
    echo ""
    echo "EXAMPLES:"
    echo "  $0                                    # Quick test"
    echo "  $0 market --count 10                 # 10 market orders"
    echo "  $0 websocket --symbol BTC            # BTC via WebSocket"
    echo "  $0 limit --offset 1.0 --count 3     # Limit orders"
    echo "  $0 compare                           # Compare transports"
    echo ""
}

log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

header() {
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} $1${NC}"
    echo -e "${BLUE}============================================${NC}"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            show_help
            exit 0
            ;;
        --symbol)
            SYMBOL="$2"
            shift 2
            ;;
        --count)
            COUNT="$2"
            shift 2
            ;;
        --size)
            SIZE="$2"
            shift 2
            ;;
        --delay)
            DELAY="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --offset)
            OFFSET="$2"
            shift 2
            ;;
        --transport)
            TRANSPORT="$2"
            shift 2
            ;;
        --no-exit)
            EXIT_AFTER="false"
            shift
            ;;
        quick|market|websocket|limit|post-only|post-only-cancel|compare|stress|custom)
            BENCHMARK_TYPE="$1"
            shift
            ;;
        *)
            error "Unknown argument: $1"
            show_help
            exit 1
            ;;
    esac
done

# Check if .env file exists
if [[ ! -f ".env" ]]; then
    warn ".env file not found. Please create one with your Hyperliquid API keys."
    warn "See .env.example for the required format."
fi

# Check if node_modules exists
if [[ ! -d "node_modules" ]]; then
    warn "node_modules not found. Running npm install..."
    npm install
fi

# Set environment variables
export BENCHMARK_AUTO_RUN=true
export BENCHMARK_EXIT_AFTER=${EXIT_AFTER:-$DEFAULT_EXIT_AFTER}

# Configure based on benchmark type
case $BENCHMARK_TYPE in
    quick)
        header "Quick Benchmark Test"
        export BENCHMARK_ORDER_TYPE="market"
        export BENCHMARK_TRANSPORT="http"
        export BENCHMARK_SYMBOL=${SYMBOL:-$DEFAULT_SYMBOL}
        export BENCHMARK_ORDER_COUNT=${COUNT:-$DEFAULT_COUNT}
        export BENCHMARK_ORDER_SIZE=${SIZE:-$DEFAULT_SIZE}
        export BENCHMARK_DELAY=${DELAY:-$DEFAULT_DELAY}
        export BENCHMARK_TIMEOUT=${TIMEOUT:-$DEFAULT_TIMEOUT}
        ;;
    market)
        header "Market Orders Benchmark"
        export BENCHMARK_ORDER_TYPE="market"
        export BENCHMARK_TRANSPORT=${TRANSPORT:-"http"}
        export BENCHMARK_SYMBOL=${SYMBOL:-$DEFAULT_SYMBOL}
        export BENCHMARK_ORDER_COUNT=${COUNT:-10}
        export BENCHMARK_ORDER_SIZE=${SIZE:-$DEFAULT_SIZE}
        export BENCHMARK_DELAY=${DELAY:-$DEFAULT_DELAY}
        export BENCHMARK_TIMEOUT=${TIMEOUT:-$DEFAULT_TIMEOUT}
        ;;
    websocket)
        header "WebSocket Transport Benchmark"
        export BENCHMARK_ORDER_TYPE="market"
        export BENCHMARK_TRANSPORT="websocket"
        export BENCHMARK_SYMBOL=${SYMBOL:-$DEFAULT_SYMBOL}
        export BENCHMARK_ORDER_COUNT=${COUNT:-10}
        export BENCHMARK_ORDER_SIZE=${SIZE:-$DEFAULT_SIZE}
        export BENCHMARK_DELAY=${DELAY:-$DEFAULT_DELAY}
        export BENCHMARK_TIMEOUT=${TIMEOUT:-$DEFAULT_TIMEOUT}
        ;;
    limit)
        header "Limit Orders Benchmark"
        export BENCHMARK_ORDER_TYPE="limit"
        export BENCHMARK_TRANSPORT=${TRANSPORT:-"http"}
        export BENCHMARK_SYMBOL=${SYMBOL:-$DEFAULT_SYMBOL}
        export BENCHMARK_ORDER_COUNT=${COUNT:-5}
        export BENCHMARK_ORDER_SIZE=${SIZE:-$DEFAULT_SIZE}
        export BENCHMARK_DELAY=${DELAY:-2000}
        export BENCHMARK_TIMEOUT=${TIMEOUT:-60000}
        if [[ -n "$OFFSET" ]]; then
            log "Using price offset: $OFFSET"
        fi
        ;;
    post-only)
        header "Post-Only Orders Benchmark"
        export BENCHMARK_ORDER_TYPE="post_only"
        export BENCHMARK_TRANSPORT=${TRANSPORT:-"http"}
        export BENCHMARK_SYMBOL=${SYMBOL:-$DEFAULT_SYMBOL}
        export BENCHMARK_ORDER_COUNT=${COUNT:-$DEFAULT_COUNT}
        export BENCHMARK_ORDER_SIZE=${SIZE:-$DEFAULT_SIZE}
        export BENCHMARK_DELAY=${DELAY:-1500}
        export BENCHMARK_TIMEOUT=${TIMEOUT:-30000}
        ;;
    post-only-cancel)
        header "Post-Only Orders + Cancel Latency Benchmark"
        log "This test places post-only orders and cancels them to measure cancel latency"
        log "Validates hypothesis: cancel orders execute faster than market orders"
        export BENCHMARK_ORDER_TYPE="post_only"
        export BENCHMARK_TRANSPORT=${TRANSPORT:-"http"}
        export BENCHMARK_SYMBOL=${SYMBOL:-$DEFAULT_SYMBOL}
        export BENCHMARK_ORDER_COUNT=${COUNT:-5}
        export BENCHMARK_ORDER_SIZE=${SIZE:-$DEFAULT_SIZE}
        export BENCHMARK_DELAY=${DELAY:-4000}  # Longer delay for cancel operations
        export BENCHMARK_TIMEOUT=${TIMEOUT:-30000}
        export BENCHMARK_TEST_CANCEL_LATENCY="true"
        export BENCHMARK_CANCEL_DELAY=${OFFSET:-2000}  # Reuse offset for cancel delay
        ;;
    compare)
        header "Transport Comparison Benchmark"
        log "Running HTTP benchmark first..."
        export BENCHMARK_ORDER_TYPE="market"
        export BENCHMARK_TRANSPORT="http"
        export BENCHMARK_SYMBOL=${SYMBOL:-$DEFAULT_SYMBOL}
        export BENCHMARK_ORDER_COUNT=${COUNT:-8}
        export BENCHMARK_ORDER_SIZE=${SIZE:-$DEFAULT_SIZE}
        export BENCHMARK_DELAY=${DELAY:-1000}
        export BENCHMARK_TIMEOUT=${TIMEOUT:-$DEFAULT_TIMEOUT}
        # Run HTTP benchmark
        npm start
        log "Waiting 3 seconds before WebSocket benchmark..."
        sleep 3
        log "Running WebSocket benchmark..."
        export BENCHMARK_TRANSPORT="websocket"
        npm start
        log "Transport comparison completed!"
        exit 0
        ;;
    stress)
        header "Stress Test Benchmark"
        warn "WARNING: This is a high-frequency test. Monitor your API limits!"
        export BENCHMARK_ORDER_TYPE="market"
        export BENCHMARK_TRANSPORT=${TRANSPORT:-"http"}
        export BENCHMARK_SYMBOL=${SYMBOL:-$DEFAULT_SYMBOL}
        export BENCHMARK_ORDER_COUNT=${COUNT:-20}
        export BENCHMARK_ORDER_SIZE=${SIZE:-"0.0005"}
        export BENCHMARK_DELAY=${DELAY:-300}
        export BENCHMARK_TIMEOUT=${TIMEOUT:-10000}
        ;;
    custom)
        header "Custom Configuration Benchmark"
        export BENCHMARK_ORDER_TYPE=${BENCHMARK_ORDER_TYPE:-"market"}
        export BENCHMARK_TRANSPORT=${TRANSPORT:-$DEFAULT_TRANSPORT}
        export BENCHMARK_SYMBOL=${SYMBOL:-$DEFAULT_SYMBOL}
        export BENCHMARK_ORDER_COUNT=${COUNT:-$DEFAULT_COUNT}
        export BENCHMARK_ORDER_SIZE=${SIZE:-$DEFAULT_SIZE}
        export BENCHMARK_DELAY=${DELAY:-$DEFAULT_DELAY}
        export BENCHMARK_TIMEOUT=${TIMEOUT:-$DEFAULT_TIMEOUT}
        ;;
    *)
        error "Unknown benchmark type: $BENCHMARK_TYPE"
        show_help
        exit 1
        ;;
esac

# Show configuration
echo ""
log "Benchmark Configuration:"
echo "  Type:         $BENCHMARK_TYPE"
echo "  Symbol:       ${BENCHMARK_SYMBOL:-$DEFAULT_SYMBOL}"
echo "  Order Type:   ${BENCHMARK_ORDER_TYPE:-market}"
echo "  Transport:    ${BENCHMARK_TRANSPORT:-$DEFAULT_TRANSPORT}"
echo "  Count:        ${BENCHMARK_ORDER_COUNT:-$DEFAULT_COUNT}"
echo "  Size:         ${BENCHMARK_ORDER_SIZE:-$DEFAULT_SIZE}"
echo "  Delay:        ${BENCHMARK_DELAY:-$DEFAULT_DELAY}ms"
echo "  Timeout:      ${BENCHMARK_TIMEOUT:-$DEFAULT_TIMEOUT}ms"
if [[ -n "$OFFSET" ]]; then
    echo "  Price Offset: $OFFSET"
fi
echo "  Exit After:   ${BENCHMARK_EXIT_AFTER:-true}"
echo ""

# Build command arguments
CMD_ARGS=""
if [[ -n "$SYMBOL" ]]; then
    CMD_ARGS="$CMD_ARGS --symbol $SYMBOL"
fi
if [[ -n "$COUNT" ]]; then
    CMD_ARGS="$CMD_ARGS --count $COUNT"
fi
if [[ -n "$SIZE" ]]; then
    CMD_ARGS="$CMD_ARGS --size $SIZE"
fi
if [[ -n "$DELAY" ]]; then
    CMD_ARGS="$CMD_ARGS --delay $DELAY"
fi
if [[ -n "$TIMEOUT" ]]; then
    CMD_ARGS="$CMD_ARGS --timeout $TIMEOUT"
fi
if [[ -n "$OFFSET" ]]; then
    CMD_ARGS="$CMD_ARGS --offset $OFFSET"
fi
if [[ -n "$TRANSPORT" ]]; then
    CMD_ARGS="$CMD_ARGS --transport $TRANSPORT"
fi

# Run the benchmark
if [[ -n "$CMD_ARGS" ]]; then
    log "Running: npm start --$CMD_ARGS"
    npm start -- $CMD_ARGS
else
    log "Running: npm start"
    npm start
fi

# Show completion message
echo ""
header "Benchmark Completed Successfully"
log "Check the output above for detailed performance metrics."

# Examples of different benchmark configurations (commented)
: '
EXAMPLE USAGE SCENARIOS:

# Basic Tests
./run-benchmark.sh                                   # Quick 5-order test
./run-benchmark.sh quick --symbol BTC               # Quick BTC test
./run-benchmark.sh market --count 10                # 10 market orders

# Transport Testing
./run-benchmark.sh websocket                        # Test WebSocket
./run-benchmark.sh compare                          # Compare HTTP vs WebSocket

# Order Type Testing
./run-benchmark.sh limit --offset 1.0 --count 3    # Limit orders with $1 offset
./run-benchmark.sh post-only --delay 2000          # Post-only with 2s delays

# Performance Testing
./run-benchmark.sh stress                           # High-frequency test
./run-benchmark.sh custom --count 50 --delay 200   # Custom stress test

# Asset Testing
./run-benchmark.sh market --symbol SOL --count 8   # SOL market orders
./run-benchmark.sh websocket --symbol BTC --size 0.002  # BTC WebSocket test

# Development Testing (no exit)
./run-benchmark.sh quick --no-exit                 # Keep server running after

ENVIRONMENT VARIABLE EXAMPLES:

# Set defaults in .env or export before running
export BENCHMARK_SYMBOL=BTC
export BENCHMARK_ORDER_SIZE=0.002
export BENCHMARK_DELAY=500
./run-benchmark.sh market

# Override via command line
BENCHMARK_ORDER_COUNT=20 ./run-benchmark.sh stress

# Complex custom configuration
export BENCHMARK_AUTO_RUN=true
export BENCHMARK_EXIT_AFTER=false
export BENCHMARK_SYMBOL=ETH
export BENCHMARK_ORDER_TYPE=limit
export BENCHMARK_TRANSPORT=websocket
export BENCHMARK_ORDER_COUNT=15
export BENCHMARK_ORDER_SIZE=0.001
export BENCHMARK_DELAY=1500
export BENCHMARK_TIMEOUT=60000
./run-benchmark.sh custom

PERFORMANCE ANALYSIS WORKFLOW:

1. Quick validation:
   ./run-benchmark.sh quick

2. Transport comparison:
   ./run-benchmark.sh compare

3. Detailed market order analysis:
   ./run-benchmark.sh market --count 20 --delay 500

4. Limit order testing:
   ./run-benchmark.sh limit --offset 0.5 --count 10

5. High-frequency stress test:
   ./run-benchmark.sh stress --count 50

TROUBLESHOOTING:

- If orders fail, check your API keys in .env
- If "insufficient balance" errors, reduce order size
- If timeouts occur, increase --timeout value
- If rate limited, increase --delay between orders
- Use --no-exit flag for debugging/development

SAFETY NOTES:

- All orders are real and use real funds
- Start with small sizes and counts
- Monitor your balance and positions
- Use testnet credentials if available
- Set appropriate delays to avoid rate limits
'
