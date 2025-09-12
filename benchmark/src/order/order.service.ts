import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as hl from '@nktkas/hyperliquid';
import {
  TransportType,
  OrderPlacementResult,
  OrderFillResult,
  OrderCancelResult,
  OrderCancelPlacementResult,
  MarketPrice,
} from '../common/interfaces/benchmark.interface';
import WebSocket from 'ws';

interface Order {
  coin: string;
  side: 'B' | 'A';
  limitPx: string;
  sz: string; // Remaining size
  oid: number;
  timestamp: number;
  // Additional fields can be added as needed, e.g., reduceOnly: boolean, orderType: string, etc.
}

interface RawBookDiff {
  new?: { sz: string };
  update?: { origSz: string; newSz: string };
  remove?: true;
}

interface L4SnapshotMessage {
  Snapshot: {
    coin: string;
    time: number;
    height: number;
    levels: Array<
      Array<{
        user: string;
        coin: string;
        side: 'B' | 'A';
        limitPx: string;
        sz: string;
        oid: number;
        timestamp: number;
        triggerCondition: string;
        isTrigger: boolean;
        triggerPx: string;
        isPositionTpsl: boolean;
        reduceOnly: boolean;
        orderType: string;
        tif: string;
        cloid: string;
      }>
    >;
  };
}

interface L4DiffMessage {
  Diff: {
    coin: string;
    block?: number;
    diffs: Array<{
      user: string;
      oid: number;
      coin: string;
      side: 'Bid' | 'Ask';
      px: string;
      raw_book_diff: RawBookDiff | 'remove';
      timestamp?: number;
    }>;
  };
}

interface L4UpdatesMessage {
  Updates: {
    time: number;
    height: number;
    order_statuses: Array<{
      time: string;
      user: string;
      status: string; // e.g., "open", "badAloPxRejected", "filled", "canceled", etc.
      order: {
        user: string | null;
        coin: string;
        side: 'B' | 'A';
        limitPx: string;
        sz: string;
        oid: number;
        timestamp: number;
        triggerCondition: string;
        isTrigger: boolean;
        triggerPx: string;
        isPositionTpsl: boolean;
        reduceOnly: boolean;
        orderType: string;
        tif: string;
        cloid: string;
      };
    }>;
  };
}

interface L4WebSocketMessage {
  channel: 'subscriptionResponse' | 'l4Book';
  data:
    | L4SnapshotMessage
    | L4DiffMessage
    | L4UpdatesMessage
    | {
        method: string;
        subscription: {
          type: string;
          coin: string;
        };
      };
}

@Injectable()
export class OrderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderService.name);

  // HTTP clients
  private httpInfoClient: hl.InfoClient;
  private httpExchangeClient: hl.ExchangeClient;

  // WebSocket clients
  private wsInfoClient: hl.InfoClient;
  private wsExchangeClient: hl.ExchangeClient;
  private subscriptionClient: hl.SubscriptionClient;
  private localSubscriptionClient: hl.SubscriptionClient;

  // L4 WebSocket client
  private l4Ws: WebSocket;
  // L4 state
  private l4Coin: string = 'SOL';
  private allOrders: Map<number, Order> = new Map();
  private readonly authority: string;
  private userFillsSubscription: hl.Subscription;
  private userEventsSubscription: hl.Subscription;
  // Order tracking
  private pendingOrders = new Map<
    string,
    {
      orderId: string;
      startTime: number;
      callback: (result: OrderFillResult) => void;
    }
  >();
  // Cancel tracking
  private pendingCancels = new Map<
    string,
    {
      orderId: string;
      startTime: number;
      callback: (result: OrderCancelResult) => void;
    }
  >();
  // Market data cache
  private marketPrices = new Map<string, MarketPrice>();

  constructor(private readonly configService: ConfigService) {
    // Get configuration
    const privateKey = this.configService.get<string>(
      'ORDER_PRIVATE_KEY',
    ) as `0x${string}`;
    this.authority = this.configService.get<string>('ORDER_PUBLIC_KEY') || '';

    if (!privateKey || !this.authority) {
      throw new Error(
        'ORDER_PRIVATE_KEY and ORDER_PUBLIC_KEY must be set in environment variables',
      );
    }

    // Initialize HTTP transports
    const httpTransport = new hl.HttpTransport();
    this.httpInfoClient = new hl.InfoClient({ transport: httpTransport });
    this.httpExchangeClient = new hl.ExchangeClient({
      wallet: privateKey,
      transport: httpTransport,
    });

    // Initialize WebSocket transports
    const wsTransport = new hl.WebSocketTransport();
    const localWsTransport = new hl.WebSocketTransport({
      // url: 'ws://localhost:8000/ws',
      url: 'ws://42.2.217.228:8000/ws',
    });
    this.wsInfoClient = new hl.InfoClient({ transport: wsTransport });
    this.wsExchangeClient = new hl.ExchangeClient({
      wallet: privateKey,
      transport: wsTransport,
    });

    this.localSubscriptionClient = new hl.SubscriptionClient({
      transport: localWsTransport, // Point this to local server
    });

    // Use local transport for subscriptions to the orderbook server
    this.subscriptionClient = new hl.SubscriptionClient({
      transport: wsTransport, // Point this to local server
    });

    this.l4Ws = new WebSocket('ws://localhost:8000/ws');
  }

  async onModuleInit() {
    await this.initializeWebSocketSubscriptions();

    // Subscribe to L2 book updates on your local server and print data
    try {
      const subscription = await this.localSubscriptionClient.l2Book(
        { coin: 'SOL' }, // Optional: Add n_levels: 20 if you want to match wscat
        (data) => {
          console.log(
            'Received L2 Book Update:',
            JSON.stringify(data, null, 2),
          );
          // data will look like: { coin: 'SOL', time: 1757651731547, levels: [[{px, sz, n}, ...], [...]] }
        },
      );
      console.log('L2 Book subscription active (ID:', subscription, ')');

      // Optional: Unsubscribe after first update (for one-time snapshot only)
      // setTimeout(() => this.subscriptionClient.unsubscribe(subscription), 1000);
    } catch (error) {
      console.error('Failed to subscribe to L2 Book:', error);
    }

    // Setup L4 subscription
    // this.setupL4Subscription();
  }

  async onModuleDestroy() {
    try {
      if (this.userFillsSubscription) {
        await this.userFillsSubscription.unsubscribe();
      }
      if (this.userEventsSubscription) {
        await this.userEventsSubscription.unsubscribe();
      }
    } catch (error) {
      this.logger.error('Error during cleanup:', error);
    }
  }

  private async initializeWebSocketSubscriptions() {
    try {
      // Subscribe to user fills for real-time order execution tracking
      this.userFillsSubscription = await this.subscriptionClient.userFills(
        { user: this.authority as `0x${string}` },
        (data: hl.WsUserFills) => {
          const notificationTime = Date.now();

          data.fills.forEach((fill) => {
            const orderId = fill.oid.toString();
            const pendingOrder = this.pendingOrders.get(orderId);
            console.log(
              `fill.time: ${fill.time}, notificationTime: ${notificationTime}`,
              `notificationTime - fill.time: ${notificationTime - fill.time}`,
            );

            if (pendingOrder) {
              const fillResult: OrderFillResult = {
                orderId,
                fillTime: fill.time,
                fillPrice: parseFloat(fill.px),
                fillSize: parseFloat(fill.sz),
                notificationTime,
              };

              pendingOrder.callback(fillResult);
              this.pendingOrders.delete(orderId);
            }
          });
        },
      );

      // TODO: Subscribe to user events for order updates (including cancellations)
      // For now, we'll rely on timing the API response latency for cancels
      // The WebSocket subscription for cancel notifications will be implemented
      // once we determine the correct types from the Hyperliquid SDK
      /*
      this.userEventsSubscription = await this.subscriptionClient.userEvents(
        { user: this.authority as `0x${string}` },
        (data: any) => {
          const notificationTime = Date.now();

          if (data.events) {
            data.events.forEach((event: any) => {
              // Handle order cancellation events
              if (event.canceled) {
                const orderId = event.canceled.oid.toString();
                const pendingCancel = this.pendingCancels.get(orderId);

                if (pendingCancel) {
                  const cancelResult: OrderCancelResult = {
                    orderId,
                    cancelTime: event.canceled.time || Date.now(),
                    notificationTime,
                  };

                  pendingCancel.callback(cancelResult);
                  this.pendingCancels.delete(orderId);
                }
              }
            });
          }
        },
      );
      */

      this.logger.log('WebSocket subscriptions initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize WebSocket subscriptions:', error);
      throw error;
    }
  }

  async getMarketPrice(symbol: string): Promise<MarketPrice> {
    try {
      const l2Book = await this.httpInfoClient.l2Book({ coin: symbol });

      const marketPrice: MarketPrice = {
        bestBid: parseFloat(l2Book.levels[0][0].px),
        bestAsk: parseFloat(l2Book.levels[1][0].px),
        timestamp: Date.now(),
      };

      this.marketPrices.set(symbol, marketPrice);
      return marketPrice;
    } catch (error) {
      this.logger.error(`Failed to get market price for ${symbol}:`, error);
      throw error;
    }
  }

  private async getAssetIndex(symbol: string): Promise<number> {
    try {
      const meta = await this.httpInfoClient.meta();
      const assetIndex = meta.universe.findIndex(
        (asset) => asset.name === symbol,
      );

      if (assetIndex === -1) {
        throw new Error(`Asset ${symbol} not found`);
      }

      return assetIndex;
    } catch (error) {
      this.logger.error(`Failed to get asset index for ${symbol}:`, error);
      throw error;
    }
  }

  private getPriceDecimals(symbol: string, price: number): number {
    // TODO: This should be dynamic based on asset info
    // For now, using hardcoded values for common assets
    const priceStr = price.toString();
    let decimals = priceStr.includes('.') ? priceStr.split('.')[1].length : 4;

    if (symbol === 'BTC') decimals = 0;
    else if (symbol === 'ETH') decimals = 1;
    else if (symbol === 'SOL') decimals = 2;

    return decimals;
  }

  private setupL4Subscription(): void {
    console.log('Setting up L4 subscription');

    // Create WebSocket here to ensure handlers are attached before connection starts
    this.l4Ws = new WebSocket('ws://localhost:8000/ws');

    // Attach an early error handler for immediate connect failures
    this.l4Ws.on('error', (error: Error) => {
      this.logger.error('Early L4 WebSocket connection error:', error);
    });
    this.l4Ws.on('open', () => {
      const subMsg = {
        method: 'subscribe',
        subscription: {
          type: 'l4Book',
          coin: this.l4Coin,
        },
      };
      console.log('Sending L4 subscription message');
      this.l4Ws.send(JSON.stringify(subMsg));
      this.logger.log(`Subscribed to L4 book for ${this.l4Coin}`);
    });
    console.log('L4 WebSocket opened');

    this.l4Ws.on('message', (data: WebSocket.RawData) => {
      try {
        const rawMessage = Buffer.isBuffer(data)
          ? data.toString('utf8')
          : data instanceof ArrayBuffer
            ? new TextDecoder().decode(data)
            : String(data);
        const msg = JSON.parse(rawMessage) as L4WebSocketMessage;
        this.handleL4Message(msg);
      } catch (error) {
        this.logger.error('Failed to parse L4 message:', error);
        const errorData = Buffer.isBuffer(data)
          ? data.toString('utf8')
          : data instanceof ArrayBuffer
            ? new TextDecoder().decode(data)
            : String(data);
        this.logger.error('Raw data:', errorData.slice(0, 500));
      }
    });

    this.l4Ws.on('error', (error: Error) => {
      this.logger.error('L4 WebSocket error:', error);
    });

    this.l4Ws.on('close', (code: number, reason: Buffer) => {
      this.logger.warn(`L4 WebSocket closed: ${code} - ${reason.toString()}`);
    });
  }

  private handleL4Message(data: unknown): void {
    try {
      const msg = data as L4WebSocketMessage;

      // Skip subscription response messages
      if (msg.channel === 'subscriptionResponse') {
        this.logger.log('L4 subscription confirmed:', JSON.stringify(msg.data));
        return;
      }

      // Handle l4Book messages
      if (msg.channel === 'l4Book' && msg.data) {
        if (
          this.isSnapshotMessage(msg.data) ||
          this.isDiffMessage(msg.data) ||
          this.isUpdatesMessage(msg.data)
        ) {
          this.processL4BookMessage(msg.data);
        } else {
          this.logger.warn(
            'Unknown l4Book data format:',
            JSON.stringify(msg.data).slice(0, 500),
          );
        }
        return;
      }

      // Unknown message format
      this.logger.warn('Unknown L4 message format:');
      console.log(JSON.stringify(msg, null, 2).slice(0, 1000));
    } catch (error) {
      this.logger.error('Failed to process L4 message:', error);
      this.logger.error('Raw message:', String(data).slice(0, 1000));
    }
  }

  private isSnapshotMessage(data: unknown): data is L4SnapshotMessage {
    return typeof data === 'object' && data !== null && 'Snapshot' in data;
  }

  private isDiffMessage(data: unknown): data is L4DiffMessage {
    return typeof data === 'object' && data !== null && 'Diff' in data;
  }

  private isUpdatesMessage(data: unknown): data is L4UpdatesMessage {
    return typeof data === 'object' && data !== null && 'Updates' in data;
  }

  private processL4BookMessage(
    data: L4SnapshotMessage | L4DiffMessage | L4UpdatesMessage,
  ): void {
    let isSnapshot = false;
    let isDiff = false;
    let isUpdates = false;

    // Handle snapshot message
    if (this.isSnapshotMessage(data)) {
      isSnapshot = true;
      const snapshot = data.Snapshot;
      const coin = snapshot.coin;

      this.logger.log(
        `Processing L4 snapshot for ${coin} at height ${snapshot.height}`,
      );

      // Clear existing orders for fresh snapshot
      this.allOrders.clear();

      // Process all levels in the snapshot
      let bidCount = 0;
      let askCount = 0;

      snapshot.levels.forEach((level) => {
        level.forEach((orderData) => {
          const order: Order = {
            coin: orderData.coin,
            side: orderData.side, // 'B' for bid, 'A' for ask
            limitPx: orderData.limitPx,
            sz: orderData.sz,
            oid: orderData.oid,
            timestamp: orderData.timestamp,
          };
          this.allOrders.set(order.oid, order);

          if (order.side === 'B') bidCount++;
          else if (order.side === 'A') askCount++;
        });
      });

      this.logger.log(
        `L4 snapshot processed for ${coin}: ${bidCount} bids, ${askCount} asks, height: ${snapshot.height}`,
      );
    }
    // Handle diff message
    else if (this.isDiffMessage(data)) {
      isDiff = true;
      const diff = data.Diff;
      const coin = diff.coin;

      diff.diffs.forEach((diffItem) => {
        this.applyL4Diff(diffItem);
      });

      this.logger.log(
        `Applied ${diff.diffs.length} L4 diffs for ${coin} (block: ${
          diff.block || 'unknown'
        })`,
      );
    }
    // Handle updates message
    else if (this.isUpdatesMessage(data)) {
      isUpdates = true;
      const updates = data.Updates;

      let processedCount = 0;
      updates.order_statuses.forEach((orderStatus) => {
        this.applyL4Update(orderStatus);
        processedCount++;
      });

      if (processedCount == 0) {
        return;
      }

      /*
      this.logger.log(
        `Applied ${processedCount} L4 updates at height ${updates.height}`,
      );
      */

      // print curreny best bid and ask
      console.log(
        `Current best bid: ${this.getSortedBids()[0].limitPx}, Current best ask: ${this.getSortedAsks()[0].limitPx}`,
      );
    }

    // After snapshot, diff, or updates, log top 5 levels (aggregated for simplicity)
    if (isSnapshot || isDiff || isUpdates) {
      this.logTopLevels();
    }
  }

  private applyL4Diff(diffItem: L4DiffMessage['Diff']['diffs'][0]): void {
    const oid = diffItem.oid;

    if (diffItem.raw_book_diff === 'remove') {
      // Remove order
      this.allOrders.delete(oid);
    } else if (
      typeof diffItem.raw_book_diff === 'object' &&
      diffItem.raw_book_diff.new
    ) {
      // New order
      const newData = diffItem.raw_book_diff.new;
      const order: Order = {
        coin: diffItem.coin,
        side: diffItem.side === 'Bid' ? 'B' : 'A',
        limitPx: diffItem.px,
        sz: newData.sz,
        oid: oid,
        timestamp: diffItem.timestamp || Date.now(),
      };
      this.allOrders.set(oid, order);
    } else if (
      typeof diffItem.raw_book_diff === 'object' &&
      diffItem.raw_book_diff.update
    ) {
      // Update existing order
      const existing = this.allOrders.get(oid);
      if (existing) {
        const updateData = diffItem.raw_book_diff.update;
        existing.sz = updateData.newSz;
        if (diffItem.timestamp) {
          existing.timestamp = diffItem.timestamp;
        }
      }
    }
  }

  private applyL4Update(
    orderStatus: L4UpdatesMessage['Updates']['order_statuses'][0],
  ): void {
    const { status, order } = orderStatus;
    const oid = order.oid;

    switch (status) {
      case 'open': {
        // New order placed and open in the book
        const newOrder: Order = {
          coin: order.coin,
          side: order.side, // Already 'B' or 'A'
          limitPx: order.limitPx,
          sz: order.sz,
          oid: order.oid,
          timestamp: order.timestamp,
        };
        this.allOrders.set(oid, newOrder);
        break;
      }

      case 'filled':
      case 'canceled':
      case 'badAloPxRejected':
      case 'rejected':
        // Order is no longer in the book - remove it
        this.allOrders.delete(oid);
        break;

      case 'partialFill': {
        // Partial fill - update the remaining size
        const existingOrder = this.allOrders.get(oid);
        if (existingOrder) {
          existingOrder.sz = order.sz; // sz should be the remaining size after partial fill
          existingOrder.timestamp = order.timestamp;
        }
        break;
      }

      default:
        // Handle other status types - some might need different logic
        // For now, log unknown status types for debugging
        this.logger.debug(`Unknown order status: ${status} for oid: ${oid}`);
        this.logger.debug(`Order: ${JSON.stringify(order)}`);
        break;
    }
  }

  private logTopLevels(): void {
    const bids = this.getSortedBids();
    const asks = this.getSortedAsks();

    if (bids.length === 0 && asks.length === 0) {
      return; // No orders to display
    }

    /*
    const topBids = this.aggregateTopLevels(bids, 5);
    const topAsks = this.aggregateTopLevels(asks, 5);
    */

    /*
    console.log(
      `L4 Book Update for ${this.l4Coin} - Top Bids:`,
      JSON.stringify(topBids.slice(0, 5), null, 2),
    );
    console.log(
      `L4 Book Update for ${this.l4Coin} - Top Asks:`,
      JSON.stringify(topAsks.slice(0, 5), null, 2),
    );
    */
  }

  // Helper to get sorted bids (desc price, asc timestamp per price)
  private getSortedBids(): Order[] {
    return Array.from(this.allOrders.values())
      .filter((o) => o.side === 'B')
      .sort((a, b) => {
        const priceDiff = parseFloat(b.limitPx) - parseFloat(a.limitPx);
        return priceDiff;
      });
  }

  // Helper to get sorted asks (asc price)
  private getSortedAsks(): Order[] {
    return Array.from(this.allOrders.values())
      .filter((o) => o.side === 'A')
      .sort((a, b) => {
        const priceDiff = parseFloat(a.limitPx) - parseFloat(b.limitPx);
        return priceDiff;
      });
  }

  // Aggregate top N levels by price (sum sizes per price)
  private aggregateTopLevels(
    orders: Order[],
    n: number,
  ): Array<{ px: string; totalSz: string }> {
    if (orders.length === 0) return [];

    const levels = new Map<string, string>();
    const isBid = orders[0]?.side === 'B';

    // Group orders by price level
    orders.forEach((order) => {
      const currentTotal = levels.get(order.limitPx) || '0';
      const newTotal = (
        parseFloat(currentTotal) + parseFloat(order.sz)
      ).toFixed(8);
      levels.set(order.limitPx, newTotal);
    });

    // Sort appropriately: bids descending (highest first), asks ascending (lowest first)
    return Array.from(levels.entries())
      .sort(([aPx], [bPx]) => {
        const diff = parseFloat(bPx) - parseFloat(aPx);
        return isBid ? diff : -diff; // Bids: high to low, Asks: low to high
      })
      .slice(0, n)
      .map(([px, totalSz]) => ({ px, totalSz }));
  }

  // Public method to access current L4 snapshot (full sorted orders)
  getL4Snapshot(): { coin: string; bids: Order[]; asks: Order[] } | null {
    if (this.allOrders.size === 0) return null;
    return {
      coin: this.l4Coin,
      bids: this.getSortedBids(),
      asks: this.getSortedAsks(),
    };
  }

  /**
   * Check if an error should be retried or is a permanent failure
   */
  private shouldRetryError(error: Error): boolean {
    if (!error?.message) return true;

    const message = String(error.message).toLowerCase();

    // Don't retry on these permanent errors
    const permanentErrors = [
      'insufficient balance',
      'order must have minimum value',
      'invalid asset',
      'asset not found',
      'unauthorized',
      'forbidden',
    ];

    return !permanentErrors.some((permError) => message.includes(permError));
  }

  async placeMarketOrder(
    symbol: string,
    side: 'long' | 'short',
    size: number,
    transportType: TransportType = TransportType.HTTP,
    fillCallback?: (result: OrderFillResult) => void,
  ): Promise<OrderPlacementResult> {
    try {
      const assetIndex = await this.getAssetIndex(symbol);
      const marketPrice = await this.getMarketPrice(symbol);

      // For market orders, use aggressive pricing to ensure fill
      const price =
        side === 'long'
          ? marketPrice.bestAsk * 1.001
          : marketPrice.bestBid * 0.999;
      const decimals = this.getPriceDecimals(symbol, price);

      const orderSentTime = Date.now();

      const exchangeClient =
        transportType === TransportType.WEBSOCKET
          ? this.wsExchangeClient
          : this.httpExchangeClient;

      const result = await exchangeClient.order({
        orders: [
          {
            a: assetIndex,
            b: side === 'long',
            p: price.toFixed(decimals),
            s: size.toString(),
            r: false,
            t: {
              limit: {
                tif: 'Ioc', // Immediate or Cancel for market-like behavior
              },
            },
          },
        ],
        grouping: 'na',
      });

      const orderReturnedTime = Date.now();

      let orderId: string | undefined;
      let success = false;

      if (result.response?.type === 'order' && result.response.data?.statuses) {
        const status = result.response.data.statuses[0];

        if (status && 'filled' in status && status.filled) {
          orderId = status.filled.oid.toString();
          success = true;
        } else if (status && 'resting' in status && status.resting) {
          orderId = status.resting.oid.toString();
          success = true;
        }
      }

      if (success && orderId && fillCallback) {
        this.pendingOrders.set(orderId, {
          orderId,
          startTime: orderSentTime,
          callback: fillCallback,
        });
      }

      return {
        orderId: orderId || '',
        success,
        orderSentTime,
        orderReturnedTime,
        errorMessage: success ? undefined : 'Order placement failed',
      };
    } catch (error) {
      const orderReturnedTime = Date.now();
      this.logger.error(`Market order failed for ${symbol}:`, error);

      return {
        orderId: '',
        success: false,
        orderSentTime: Date.now(),
        orderReturnedTime,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async placeLimitOrder(
    symbol: string,
    side: 'long' | 'short',
    size: number,
    price: number,
    transportType: TransportType = TransportType.HTTP,
    fillCallback?: (result: OrderFillResult) => void,
  ): Promise<OrderPlacementResult> {
    try {
      const assetIndex = await this.getAssetIndex(symbol);
      const decimals = this.getPriceDecimals(symbol, price);

      const orderSentTime = Date.now();

      const exchangeClient =
        transportType === TransportType.WEBSOCKET
          ? this.wsExchangeClient
          : this.httpExchangeClient;

      const result = await exchangeClient.order({
        orders: [
          {
            a: assetIndex,
            b: side === 'long',
            p: price.toFixed(decimals),
            s: size.toString(),
            r: false,
            t: {
              limit: {
                tif: 'Gtc', // Good Till Canceled for limit orders
              },
            },
          },
        ],
        grouping: 'na',
      });

      const orderReturnedTime = Date.now();

      let orderId: string | undefined;
      let success = false;

      if (result.response?.type === 'order' && result.response.data?.statuses) {
        const status = result.response.data.statuses[0];

        if (status && 'filled' in status && status.filled) {
          orderId = status.filled.oid.toString();
          success = true;
        } else if (status && 'resting' in status && status.resting) {
          orderId = status.resting.oid.toString();
          success = true;
        }
      }

      if (success && orderId && fillCallback) {
        this.pendingOrders.set(orderId, {
          orderId,
          startTime: orderSentTime,
          callback: fillCallback,
        });
      }

      return {
        orderId: orderId || '',
        success,
        orderSentTime,
        orderReturnedTime,
        errorMessage: success ? undefined : 'Order placement failed',
      };
    } catch (error) {
      const orderReturnedTime = Date.now();
      this.logger.error(`Limit order failed for ${symbol}:`, error);

      return {
        orderId: '',
        success: false,
        orderSentTime: Date.now(),
        orderReturnedTime,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async placePostOnlyOrder(
    symbol: string,
    side: 'long' | 'short',
    size: number,
    price: number,
    transportType: TransportType = TransportType.HTTP,
    fillCallback?: (result: OrderFillResult) => void,
  ): Promise<OrderPlacementResult> {
    try {
      const assetIndex = await this.getAssetIndex(symbol);
      const decimals = this.getPriceDecimals(symbol, price);

      const orderSentTime = Date.now();

      const exchangeClient =
        transportType === TransportType.WEBSOCKET
          ? this.wsExchangeClient
          : this.httpExchangeClient;

      const result = await exchangeClient.order({
        orders: [
          {
            a: assetIndex,
            b: side === 'long',
            p: price.toFixed(decimals),
            s: size.toString(),
            r: false,
            t: {
              limit: {
                tif: 'Alo', // Add Liquidity Only for post-only orders
              },
            },
          },
        ],
        grouping: 'na',
      });

      const orderReturnedTime = Date.now();

      let orderId: string | undefined;
      let success = false;

      if (result.response?.type === 'order' && result.response.data?.statuses) {
        const status = result.response.data.statuses[0];

        if (status && 'resting' in status && status.resting) {
          orderId = status.resting.oid.toString();
          success = true;
        }
      }

      if (success && orderId && fillCallback) {
        this.pendingOrders.set(orderId, {
          orderId,
          startTime: orderSentTime,
          callback: fillCallback,
        });
      }

      return {
        orderId: orderId || '',
        success,
        orderSentTime,
        orderReturnedTime,
        errorMessage: success ? undefined : 'Order placement failed',
      };
    } catch (error) {
      const orderReturnedTime = Date.now();
      this.logger.error(`Post-only order failed for ${symbol}:`, error);

      return {
        orderId: '',
        success: false,
        orderSentTime: Date.now(),
        orderReturnedTime,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async cancelOrder(
    symbol: string,
    orderId: string,
    cancelCallback?: (result: OrderCancelResult) => void,
  ): Promise<OrderCancelPlacementResult> {
    try {
      const assetIndex = await this.getAssetIndex(symbol);

      const cancelSentTime = Date.now();

      const result = await this.httpExchangeClient.cancel({
        cancels: [{ a: assetIndex, o: parseInt(orderId) }],
      });

      const cancelReturnedTime = Date.now();

      const success =
        result.response.type === 'cancel' &&
        result.response.data.statuses[0] === 'success';

      if (success) {
        this.pendingOrders.delete(orderId);

        // If callback provided, call it immediately with API response timing
        // In the future, this could be enhanced with WebSocket notification timing
        if (cancelCallback) {
          const cancelResult: OrderCancelResult = {
            orderId,
            cancelTime: cancelReturnedTime, // Use API response time as cancel time
            notificationTime: cancelReturnedTime, // Same as cancel time for now
          };

          // Call the callback immediately
          setTimeout(() => cancelCallback(cancelResult), 0);
        }
      }

      return {
        orderId,
        success,
        cancelSentTime,
        cancelReturnedTime,
        errorMessage: success ? undefined : 'Order cancellation failed',
      };
    } catch (error) {
      const cancelReturnedTime = Date.now();
      this.logger.error(`Failed to cancel order ${orderId}:`, error);

      return {
        orderId,
        success: false,
        cancelSentTime: Date.now(),
        cancelReturnedTime,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Utility method to clean up expired pending orders and cancels
  cleanupExpiredOrders(timeoutMs: number = 30000) {
    const now = Date.now();

    // Clean up expired pending orders
    for (const [orderId, order] of this.pendingOrders.entries()) {
      if (now - order.startTime > timeoutMs) {
        this.pendingOrders.delete(orderId);
        this.logger.warn(`Cleaned up expired pending order: ${orderId}`);
      }
    }

    // Clean up expired pending cancels
    for (const [orderId, cancel] of this.pendingCancels.entries()) {
      if (now - cancel.startTime > timeoutMs) {
        this.pendingCancels.delete(orderId);
        this.logger.warn(`Cleaned up expired pending cancel: ${orderId}`);
      }
    }
  }
}
