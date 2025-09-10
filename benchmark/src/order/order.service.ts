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
  MarketPrice,
} from '../common/interfaces/benchmark.interface';

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

  private readonly authority: string;
  private userFillsSubscription: hl.Subscription;

  // Order tracking
  private pendingOrders = new Map<
    string,
    {
      orderId: string;
      startTime: number;
      callback: (result: OrderFillResult) => void;
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
    this.wsInfoClient = new hl.InfoClient({ transport: wsTransport });
    this.wsExchangeClient = new hl.ExchangeClient({
      wallet: privateKey,
      transport: wsTransport,
    });
    this.subscriptionClient = new hl.SubscriptionClient({
      transport: wsTransport,
    });
  }

  async onModuleInit() {
    await this.initializeWebSocketSubscriptions();
  }

  async onModuleDestroy() {
    try {
      if (this.userFillsSubscription) {
        await this.userFillsSubscription.unsubscribe();
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

  async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
    try {
      const assetIndex = await this.getAssetIndex(symbol);

      const result = await this.httpExchangeClient.cancel({
        cancels: [{ a: assetIndex, o: parseInt(orderId) }],
      });

      const success =
        result.response.type === 'cancel' &&
        result.response.data.statuses[0] === 'success';

      if (success) {
        this.pendingOrders.delete(orderId);
      }

      return success;
    } catch (error) {
      this.logger.error(`Failed to cancel order ${orderId}:`, error);
      return false;
    }
  }

  // Utility method to clean up expired pending orders
  cleanupExpiredOrders(timeoutMs: number = 30000) {
    const now = Date.now();
    for (const [orderId, order] of this.pendingOrders.entries()) {
      if (now - order.startTime > timeoutMs) {
        this.pendingOrders.delete(orderId);
        this.logger.warn(`Cleaned up expired pending order: ${orderId}`);
      }
    }
  }
}
