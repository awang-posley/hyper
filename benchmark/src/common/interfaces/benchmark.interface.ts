export enum OrderType {
  MARKET = 'market', // IOC
  LIMIT = 'limit', // GTC
  POST_ONLY = 'post_only', // ALO
}

export enum TransportType {
  WEBSOCKET = 'websocket',
  HTTP = 'http',
}

export interface OrderExecutionMetrics {
  orderId: string;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  requestedPrice?: number;

  // Timestamps
  orderSentTime: number; // When order request was sent
  orderReturnedTime: number; // When order response was received
  orderFilledTime?: number; // When order was actually filled on-chain
  fillNotificationTime?: number; // When we received fill notification

  // Results
  success: boolean;
  fillPrice?: number;
  fillSize?: number;
  errorMessage?: string;

  // Latency calculations
  sendToReturnLatency: number; // orderReturnedTime - orderSentTime
  returnToFillLatency?: number; // orderFilledTime - orderReturnedTime
  sendToFillLatency?: number; // orderFilledTime - orderSentTime
  fillToNotificationLatency?: number; // fillNotificationTime - orderFilledTime
}

export interface BenchmarkConfig {
  symbol: string;
  orderType: OrderType;
  transportType: TransportType;
  orderSize: number;
  numberOfOrders: number;
  priceOffset?: number; // For limit orders, offset from market price (positive for long, negative for short)
  delayBetweenOrders: number; // milliseconds
  maxOrderTimeout: number; // milliseconds
}

export interface BenchmarkResult {
  config: BenchmarkConfig;
  startTime: number;
  endTime: number;
  totalDuration: number;

  orders: OrderExecutionMetrics[];

  // Summary statistics
  successRate: number;
  totalSuccessfulOrders: number;
  totalFailedOrders: number;

  // Latency statistics (in milliseconds)
  avgSendToReturnLatency: number;
  minSendToReturnLatency: number;
  maxSendToReturnLatency: number;
  p50SendToReturnLatency: number;
  p95SendToReturnLatency: number;
  p99SendToReturnLatency: number;

  avgSendToFillLatency?: number;
  minSendToFillLatency?: number;
  maxSendToFillLatency?: number;
  p50SendToFillLatency?: number;
  p95SendToFillLatency?: number;
  p99SendToFillLatency?: number;

  avgFillToNotificationLatency?: number;
  minFillToNotificationLatency?: number;
  maxFillToNotificationLatency?: number;

  // Price performance
  avgFillPrice?: number;
  priceSlippage?: number; // Difference between requested and filled price

  // Error analysis
  errorCategories: { [error: string]: number };
}

export interface MarketPrice {
  bestBid: number;
  bestAsk: number;
  timestamp: number;
}

export interface OrderPlacementResult {
  orderId: string;
  success: boolean;
  orderSentTime: number;
  orderReturnedTime: number;
  errorMessage?: string;
}

export interface OrderFillResult {
  orderId: string;
  fillTime: number;
  fillPrice: number;
  fillSize: number;
  notificationTime: number;
}
