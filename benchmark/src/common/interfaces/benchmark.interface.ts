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

  // Cancel timestamps (for post-only + cancel tests)
  cancelSentTime?: number; // When cancel request was sent
  cancelReturnedTime?: number; // When cancel response was received
  cancelNotificationTime?: number; // When we received cancel notification via WebSocket

  // Results
  success: boolean;
  fillPrice?: number;
  fillSize?: number;
  errorMessage?: string;
  cancelSuccess?: boolean; // Whether the cancel operation succeeded
  cancelErrorMessage?: string;

  // Latency calculations
  sendToReturnLatency: number; // orderReturnedTime - orderSentTime
  returnToFillLatency?: number; // orderFilledTime - orderReturnedTime
  sendToFillLatency?: number; // orderFilledTime - orderSentTime
  fillToNotificationLatency?: number; // fillNotificationTime - orderFilledTime

  // Cancel latency calculations
  cancelSendToReturnLatency?: number; // cancelReturnedTime - cancelSentTime
  cancelReturnToNotificationLatency?: number; // cancelNotificationTime - cancelReturnedTime
  cancelSendToNotificationLatency?: number; // cancelNotificationTime - cancelSentTime
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
  testCancelLatency?: boolean; // For post-only orders, test cancel latency after placement
  delayCancelAfterPlacement?: number; // milliseconds to wait before canceling (for cancel latency testing)
  maxRetries?: number; // Maximum number of retries for failed operations (default: 3)
  retryBaseDelay?: number; // Base delay for retry backoff in milliseconds (default: 1000)
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

  // Cancel latency statistics (for post-only + cancel tests)
  cancelSuccessRate?: number;
  totalSuccessfulCancels?: number;
  totalFailedCancels?: number;

  avgCancelSendToReturnLatency?: number;
  minCancelSendToReturnLatency?: number;
  maxCancelSendToReturnLatency?: number;
  p50CancelSendToReturnLatency?: number;
  p95CancelSendToReturnLatency?: number;
  p99CancelSendToReturnLatency?: number;

  avgCancelSendToNotificationLatency?: number;
  minCancelSendToNotificationLatency?: number;
  maxCancelSendToNotificationLatency?: number;
  p50CancelSendToNotificationLatency?: number;
  p95CancelSendToNotificationLatency?: number;
  p99CancelSendToNotificationLatency?: number;

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

export interface OrderCancelResult {
  orderId: string;
  cancelTime: number;
  notificationTime: number;
}

export interface OrderCancelPlacementResult {
  orderId: string;
  success: boolean;
  cancelSentTime: number;
  cancelReturnedTime: number;
  errorMessage?: string;
}
