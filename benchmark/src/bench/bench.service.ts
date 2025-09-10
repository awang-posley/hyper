import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderService } from '../order/order.service';
import {
  BenchmarkConfig,
  BenchmarkResult,
  OrderExecutionMetrics,
  OrderType,
  TransportType,
  OrderFillResult,
  OrderPlacementResult,
} from '../common/interfaces/benchmark.interface';

@Injectable()
export class BenchService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BenchService.name);
  private isRunning = false;
  private currentBenchmark: BenchmarkResult | null = null;

  constructor(
    private readonly orderService: OrderService,
    private readonly configService: ConfigService,
  ) {}

  onApplicationBootstrap() {
    // Check for auto-run configuration
    const autoRun = this.configService.get<string>('BENCHMARK_AUTO_RUN');
    if (autoRun === 'true') {
      this.logger.log('Auto-run benchmark detected, starting benchmark...');

      // Small delay to ensure all services are initialized
      setTimeout(() => {
        this.runAutoConfiguredBenchmark().catch((error) => {
          this.logger.error('Auto-run benchmark failed:', error);
        });
      }, 1000);
    }
  }

  private async runAutoConfiguredBenchmark(): Promise<void> {
    try {
      const config = this.buildConfigFromEnvironment();

      this.logger.log(
        'Running auto-configured benchmark:',
        JSON.stringify(config, null, 2),
      );

      await this.runBenchmark(config);

      this.logger.log('Auto-benchmark completed successfully');

      // Exit after benchmark if configured to do so
      const exitAfter = this.configService.get<string>('BENCHMARK_EXIT_AFTER');
      if (exitAfter === 'true') {
        this.logger.log('Exiting application after benchmark completion...');
        setTimeout(() => process.exit(0), 2000);
      }
    } catch (error) {
      this.logger.error('Auto-configured benchmark failed:', error);
      const exitAfter = this.configService.get<string>('BENCHMARK_EXIT_AFTER');
      if (exitAfter === 'true') {
        setTimeout(() => process.exit(1), 1000);
      }
    }
  }

  private buildConfigFromEnvironment(): BenchmarkConfig {
    // Parse command line arguments for overrides
    const args = this.parseCommandLineArgs();

    const config: BenchmarkConfig = {
      symbol:
        args.symbol ||
        this.configService.get<string>('BENCHMARK_SYMBOL') ||
        'ETH',

      orderType: this.parseOrderType(
        args.orderType ||
          this.configService.get<string>('BENCHMARK_ORDER_TYPE') ||
          'market',
      ),

      transportType: this.parseTransportType(
        args.transport ||
          this.configService.get<string>('BENCHMARK_TRANSPORT') ||
          'http',
      ),

      orderSize: parseFloat(
        args.size ||
          this.configService.get<string>('BENCHMARK_ORDER_SIZE') ||
          '0.001',
      ),

      numberOfOrders: parseInt(
        args.count ||
          this.configService.get<string>('BENCHMARK_ORDER_COUNT') ||
          '5',
      ),

      delayBetweenOrders: parseInt(
        args.delay ||
          this.configService.get<string>('BENCHMARK_DELAY') ||
          '1000',
      ),

      maxOrderTimeout: parseInt(
        args.timeout ||
          this.configService.get<string>('BENCHMARK_TIMEOUT') ||
          '30000',
      ),

      priceOffset: args.offset ? parseFloat(args.offset) : undefined,
    };

    return config;
  }

  private parseCommandLineArgs(): Record<string, string> {
    const args: Record<string, string> = {};
    const processArgs = process.argv.slice(2);

    for (let i = 0; i < processArgs.length; i++) {
      const arg = processArgs[i];
      if (arg.startsWith('--')) {
        const key = arg.substring(2);
        const value = processArgs[i + 1];
        if (value && !value.startsWith('--')) {
          args[key] = value;
          i++; // Skip the value in next iteration
        }
      }
    }

    return args;
  }

  private parseOrderType(type: string): OrderType {
    switch (type.toLowerCase()) {
      case 'market':
        return OrderType.MARKET;
      case 'limit':
        return OrderType.LIMIT;
      case 'post_only':
      case 'post-only':
      case 'postonly':
        return OrderType.POST_ONLY;
      default:
        this.logger.warn(`Unknown order type: ${type}, defaulting to market`);
        return OrderType.MARKET;
    }
  }

  private parseTransportType(type: string): TransportType {
    switch (type.toLowerCase()) {
      case 'http':
        return TransportType.HTTP;
      case 'websocket':
      case 'ws':
        return TransportType.WEBSOCKET;
      default:
        this.logger.warn(`Unknown transport type: ${type}, defaulting to http`);
        return TransportType.HTTP;
    }
  }

  /**
   * Main benchmark function that tests order placement performance
   */
  async runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
    if (this.isRunning) {
      throw new Error(
        'A benchmark is already running. Please wait for it to complete.',
      );
    }

    this.isRunning = true;
    const startTime = Date.now();

    this.logger.log(
      `Starting benchmark: ${config.orderType} orders on ${config.symbol}`,
    );

    const result: BenchmarkResult = {
      config,
      startTime,
      endTime: 0,
      totalDuration: 0,
      orders: [],
      successRate: 0,
      totalSuccessfulOrders: 0,
      totalFailedOrders: 0,
      avgSendToReturnLatency: 0,
      minSendToReturnLatency: 0,
      maxSendToReturnLatency: 0,
      p50SendToReturnLatency: 0,
      p95SendToReturnLatency: 0,
      p99SendToReturnLatency: 0,
      errorCategories: {},
    };

    try {
      // Sequential order placement
      for (let i = 0; i < config.numberOfOrders; i++) {
        this.logger.log(`Placing order ${i + 1}/${config.numberOfOrders}`);

        const orderMetrics = await this.executeOrder(config, i);
        result.orders.push(orderMetrics);

        // Clean up any expired orders
        this.orderService.cleanupExpiredOrders(config.maxOrderTimeout);

        // Wait between orders if specified
        if (config.delayBetweenOrders > 0 && i < config.numberOfOrders - 1) {
          await this.sleep(config.delayBetweenOrders);
        }
      }

      // Calculate final statistics
      const endTime = Date.now();
      result.endTime = endTime;
      result.totalDuration = endTime - startTime;

      this.calculateStatistics(result);
      this.currentBenchmark = result;

      this.logger.log('Benchmark completed successfully');
      this.logBenchmarkSummary(result);

      return result;
    } catch (error) {
      this.logger.error('Benchmark failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  private async executeOrder(
    config: BenchmarkConfig,
    orderIndex: number,
  ): Promise<OrderExecutionMetrics> {
    const side: 'long' | 'short' = orderIndex % 2 === 0 ? 'long' : 'short';
    let fillResult: OrderFillResult | null = null;
    let orderTimeoutHandle: NodeJS.Timeout | null = null;

    let resolveFillPromise: (result: OrderFillResult) => void;
    const fillPromise = new Promise<OrderFillResult>((resolve, reject) => {
      resolveFillPromise = resolve;
      orderTimeoutHandle = setTimeout(() => {
        reject(new Error('Order fill timeout'));
      }, config.maxOrderTimeout);
    });

    const fillCallback = (result: OrderFillResult) => {
      if (orderTimeoutHandle) {
        clearTimeout(orderTimeoutHandle);
      }
      fillResult = result;
      resolveFillPromise(result);
    };

    let placementResult: OrderPlacementResult;
    let requestedPrice: number | undefined;

    try {
      switch (config.orderType) {
        case OrderType.MARKET:
          placementResult = await this.orderService.placeMarketOrder(
            config.symbol,
            side,
            config.orderSize,
            config.transportType,
            fillCallback,
          );
          break;

        case OrderType.LIMIT: {
          const marketPrice = await this.orderService.getMarketPrice(
            config.symbol,
          );
          const basePrice =
            side === 'long' ? marketPrice.bestBid : marketPrice.bestAsk;
          const offset = config.priceOffset || 0;
          requestedPrice =
            side === 'long' ? basePrice - offset : basePrice + offset;

          placementResult = await this.orderService.placeLimitOrder(
            config.symbol,
            side,
            config.orderSize,
            requestedPrice,
            config.transportType,
            fillCallback,
          );
          break;
        }

        case OrderType.POST_ONLY: {
          const marketPrice = await this.orderService.getMarketPrice(
            config.symbol,
          );
          const basePrice =
            side === 'long' ? marketPrice.bestBid : marketPrice.bestAsk;
          const offset = config.priceOffset || basePrice * 0.001;
          requestedPrice =
            side === 'long' ? basePrice - offset : basePrice + offset;

          placementResult = await this.orderService.placePostOnlyOrder(
            config.symbol,
            side,
            config.orderSize,
            requestedPrice,
            config.transportType,
            fillCallback,
          );
          break;
        }

        default:
          throw new Error(
            `Unsupported order type: ${config.orderType as string}`,
          );
      }

      // Wait for fill or timeout (only for successful order placements)
      if (placementResult.success && config.orderType !== OrderType.POST_ONLY) {
        try {
          await fillPromise;
        } catch {
          this.logger.warn(
            `Order fill timeout for order ${placementResult.orderId}`,
          );
        }
      }

      // Build metrics
      const metrics: OrderExecutionMetrics = {
        orderId: placementResult.orderId,
        symbol: config.symbol,
        side,
        size: config.orderSize,
        requestedPrice,
        orderSentTime: placementResult.orderSentTime,
        orderReturnedTime: placementResult.orderReturnedTime,
        success: placementResult.success,
        sendToReturnLatency:
          placementResult.orderReturnedTime - placementResult.orderSentTime,
        errorMessage: placementResult.errorMessage,
      };

      // Add fill data if available
      if (fillResult !== null) {
        const fill = fillResult as OrderFillResult;
        metrics.orderFilledTime = fill.fillTime;
        metrics.fillNotificationTime = fill.notificationTime;
        metrics.fillPrice = fill.fillPrice;
        metrics.fillSize = fill.fillSize;
        metrics.returnToFillLatency =
          fill.fillTime - placementResult.orderReturnedTime;
        metrics.sendToFillLatency =
          fill.fillTime - placementResult.orderSentTime;
        metrics.fillToNotificationLatency =
          fill.notificationTime - fill.fillTime;
      }

      return metrics;
    } catch (error) {
      if (orderTimeoutHandle) {
        clearTimeout(orderTimeoutHandle);
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Order ${orderIndex + 1} failed:`, errorMessage);

      return {
        orderId: '',
        symbol: config.symbol,
        side,
        size: config.orderSize,
        requestedPrice,
        orderSentTime: Date.now(),
        orderReturnedTime: Date.now(),
        success: false,
        sendToReturnLatency: 0,
        errorMessage,
      };
    }
  }

  private calculateStatistics(result: BenchmarkResult): void {
    const successfulOrders = result.orders.filter((order) => order.success);
    const failedOrders = result.orders.filter((order) => !order.success);

    result.totalSuccessfulOrders = successfulOrders.length;
    result.totalFailedOrders = failedOrders.length;
    result.successRate =
      result.orders.length > 0
        ? (successfulOrders.length / result.orders.length) * 100
        : 0;

    // Calculate latency statistics
    const sendToReturnLatencies = successfulOrders
      .map((order) => order.sendToReturnLatency)
      .sort((a, b) => a - b);

    if (sendToReturnLatencies.length > 0) {
      result.avgSendToReturnLatency =
        sendToReturnLatencies.reduce((a, b) => a + b, 0) /
        sendToReturnLatencies.length;
      result.minSendToReturnLatency = sendToReturnLatencies[0];
      result.maxSendToReturnLatency =
        sendToReturnLatencies[sendToReturnLatencies.length - 1];
      result.p50SendToReturnLatency = this.getPercentile(
        sendToReturnLatencies,
        50,
      );
      result.p95SendToReturnLatency = this.getPercentile(
        sendToReturnLatencies,
        95,
      );
      result.p99SendToReturnLatency = this.getPercentile(
        sendToReturnLatencies,
        99,
      );
    }

    // Calculate fill latency statistics
    const fillLatencies = successfulOrders
      .filter((order) => order.sendToFillLatency !== undefined)
      .map((order) => order.sendToFillLatency!)
      .sort((a, b) => a - b);

    if (fillLatencies.length > 0) {
      result.avgSendToFillLatency =
        fillLatencies.reduce((a, b) => a + b, 0) / fillLatencies.length;
      result.minSendToFillLatency = fillLatencies[0];
      result.maxSendToFillLatency = fillLatencies[fillLatencies.length - 1];
      result.p50SendToFillLatency = this.getPercentile(fillLatencies, 50);
      result.p95SendToFillLatency = this.getPercentile(fillLatencies, 95);
      result.p99SendToFillLatency = this.getPercentile(fillLatencies, 99);
    }

    // Calculate notification latency statistics
    const notificationLatencies = successfulOrders
      .filter((order) => order.fillToNotificationLatency !== undefined)
      .map((order) => order.fillToNotificationLatency!)
      .sort((a, b) => a - b);

    if (notificationLatencies.length > 0) {
      result.avgFillToNotificationLatency =
        notificationLatencies.reduce((a, b) => a + b, 0) /
        notificationLatencies.length;
      result.minFillToNotificationLatency = notificationLatencies[0];
      result.maxFillToNotificationLatency =
        notificationLatencies[notificationLatencies.length - 1];
    }

    // Calculate price metrics
    const filledOrders = successfulOrders.filter(
      (order) => order.fillPrice !== undefined,
    );
    if (filledOrders.length > 0) {
      result.avgFillPrice =
        filledOrders.reduce((sum, order) => sum + order.fillPrice!, 0) /
        filledOrders.length;

      const ordersWithRequestedPrice = filledOrders.filter(
        (order) => order.requestedPrice !== undefined,
      );
      if (ordersWithRequestedPrice.length > 0) {
        const totalSlippage = ordersWithRequestedPrice.reduce((sum, order) => {
          return sum + Math.abs(order.fillPrice! - order.requestedPrice!);
        }, 0);
        result.priceSlippage = totalSlippage / ordersWithRequestedPrice.length;
      }
    }

    // Categorize errors
    failedOrders.forEach((order) => {
      const errorKey = order.errorMessage || 'Unknown Error';
      result.errorCategories[errorKey] =
        (result.errorCategories[errorKey] || 0) + 1;
    });
  }

  private getPercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;

    const index = (percentile / 100) * (sortedArray.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
      return sortedArray[lower];
    }

    const weight = index - lower;
    return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
  }

  private logBenchmarkSummary(result: BenchmarkResult): void {
    const summary = [
      '='.repeat(80),
      'BENCHMARK SUMMARY',
      '='.repeat(80),
      `Symbol: ${result.config.symbol}`,
      `Order Type: ${result.config.orderType}`,
      `Transport: ${result.config.transportType}`,
      `Order Size: ${result.config.orderSize}`,
      `Total Orders: ${result.config.numberOfOrders}`,
      `Total Duration: ${result.totalDuration}ms`,
      '',
      'SUCCESS METRICS:',
      `Success Rate: ${result.successRate.toFixed(2)}%`,
      `Successful Orders: ${result.totalSuccessfulOrders}`,
      `Failed Orders: ${result.totalFailedOrders}`,
      '',
      'LATENCY METRICS (Send to Return):',
      `Average: ${result.avgSendToReturnLatency.toFixed(2)}ms`,
      `Min: ${result.minSendToReturnLatency}ms`,
      `Max: ${result.maxSendToReturnLatency}ms`,
      `P50: ${result.p50SendToReturnLatency.toFixed(2)}ms`,
      `P95: ${result.p95SendToReturnLatency.toFixed(2)}ms`,
      `P99: ${result.p99SendToReturnLatency.toFixed(2)}ms`,
    ];

    if (result.avgSendToFillLatency !== undefined) {
      summary.push(
        '',
        'FILL LATENCY METRICS (Send to Fill):',
        `Average: ${result.avgSendToFillLatency.toFixed(2)}ms`,
        `Min: ${result.minSendToFillLatency}ms`,
        `Max: ${result.maxSendToFillLatency}ms`,
        `P50: ${result.p50SendToFillLatency!.toFixed(2)}ms`,
        `P95: ${result.p95SendToFillLatency!.toFixed(2)}ms`,
        `P99: ${result.p99SendToFillLatency!.toFixed(2)}ms`,
      );
    }

    if (result.avgFillToNotificationLatency !== undefined) {
      summary.push(
        '',
        'NOTIFICATION LATENCY METRICS:',
        `Average Fill-to-Notification: ${result.avgFillToNotificationLatency.toFixed(2)}ms`,
        `Min: ${result.minFillToNotificationLatency}ms`,
        `Max: ${result.maxFillToNotificationLatency}ms`,
      );
    }

    if (result.avgFillPrice !== undefined) {
      summary.push(
        '',
        'PRICE METRICS:',
        `Average Fill Price: ${result.avgFillPrice.toFixed(6)}`,
      );

      if (result.priceSlippage !== undefined) {
        summary.push(`Average Slippage: ${result.priceSlippage.toFixed(6)}`);
      }
    }

    if (Object.keys(result.errorCategories).length > 0) {
      summary.push('', 'ERROR CATEGORIES:');
      Object.entries(result.errorCategories).forEach(([error, count]) => {
        summary.push(`${error}: ${count}`);
      });
    }

    summary.push('='.repeat(80));

    this.logger.log(summary.join('\n'));
  }

  getCurrentBenchmarkResult(): BenchmarkResult | null {
    return this.currentBenchmark;
  }

  isBenchmarkRunning(): boolean {
    return this.isRunning;
  }

  createDefaultConfig(
    overrides: Partial<BenchmarkConfig> = {},
  ): BenchmarkConfig {
    return {
      symbol: 'ETH',
      orderType: OrderType.MARKET,
      transportType: TransportType.HTTP,
      orderSize: 0.001,
      numberOfOrders: 10,
      delayBetweenOrders: 1000,
      maxOrderTimeout: 30000,
      ...overrides,
    };
  }

  async runQuickBenchmark(
    orderType: OrderType = OrderType.MARKET,
    transportType: TransportType = TransportType.HTTP,
    numberOfOrders: number = 5,
  ): Promise<BenchmarkResult> {
    const config = this.createDefaultConfig({
      orderType,
      transportType,
      numberOfOrders,
    });

    return this.runBenchmark(config);
  }

  async compareTransports(
    config: Omit<BenchmarkConfig, 'transportType'>,
  ): Promise<{ http: BenchmarkResult; websocket: BenchmarkResult }> {
    this.logger.log('Starting transport comparison benchmark...');

    const httpConfig: BenchmarkConfig = {
      ...config,
      transportType: TransportType.HTTP,
    };
    const httpResult = await this.runBenchmark(httpConfig);

    await this.sleep(2000);

    const wsConfig: BenchmarkConfig = {
      ...config,
      transportType: TransportType.WEBSOCKET,
    };
    const wsResult = await this.runBenchmark(wsConfig);

    this.logTransportComparison(httpResult, wsResult);

    return { http: httpResult, websocket: wsResult };
  }

  private logTransportComparison(
    httpResult: BenchmarkResult,
    wsResult: BenchmarkResult,
  ): void {
    const comparison = [
      '='.repeat(80),
      'TRANSPORT COMPARISON',
      '='.repeat(80),
      '',
      'HTTP vs WebSocket Performance:',
      '',
      'Success Rate:',
      `  HTTP: ${httpResult.successRate.toFixed(2)}%`,
      `  WebSocket: ${wsResult.successRate.toFixed(2)}%`,
      '',
      'Average Send-to-Return Latency:',
      `  HTTP: ${httpResult.avgSendToReturnLatency.toFixed(2)}ms`,
      `  WebSocket: ${wsResult.avgSendToReturnLatency.toFixed(2)}ms`,
      `  Difference: ${(wsResult.avgSendToReturnLatency - httpResult.avgSendToReturnLatency).toFixed(2)}ms`,
    ];

    if (
      httpResult.avgSendToFillLatency !== undefined &&
      wsResult.avgSendToFillLatency !== undefined
    ) {
      comparison.push(
        '',
        'Average Send-to-Fill Latency:',
        `  HTTP: ${httpResult.avgSendToFillLatency.toFixed(2)}ms`,
        `  WebSocket: ${wsResult.avgSendToFillLatency.toFixed(2)}ms`,
        `  Difference: ${(wsResult.avgSendToFillLatency - httpResult.avgSendToFillLatency).toFixed(2)}ms`,
      );
    }

    comparison.push('='.repeat(80));
    this.logger.log(comparison.join('\n'));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
