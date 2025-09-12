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
  OrderCancelResult,
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
    // const autoRun = this.configService.get<string>('BENCHMARK_AUTO_RUN');
    /*
    if (autoRun === 'true') {
      this.logger.log('Auto-run benchmark detected, starting benchmark...');

      // Small delay to ensure all services are initialized
      setTimeout(() => {
        this.runAutoConfiguredBenchmark().catch((error) => {
          this.logger.error('Auto-run benchmark failed:', error);
        });
      }, 1000);
    }
    */
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

      testCancelLatency:
        args.testCancel === 'true' ||
        this.configService.get<string>('BENCHMARK_TEST_CANCEL_LATENCY') ===
          'true',

      delayCancelAfterPlacement: parseInt(
        args.cancelDelay ||
          this.configService.get<string>('BENCHMARK_CANCEL_DELAY') ||
          '2000',
      ),

      maxRetries: parseInt(
        args.maxRetries ||
          this.configService.get<string>('BENCHMARK_MAX_RETRIES') ||
          '3',
      ),

      retryBaseDelay: parseInt(
        args.retryDelay ||
          this.configService.get<string>('BENCHMARK_RETRY_DELAY') ||
          '1000',
      ),
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
    let cancelMetrics: {
      cancelSentTime: number;
      cancelReturnedTime: number;
      cancelSuccess: boolean;
      cancelErrorMessage?: string;
      cancelSendToReturnLatency: number;
      cancelNotificationTime?: number;
      cancelReturnToNotificationLatency?: number;
      cancelSendToNotificationLatency?: number;
    } | null = null;

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
          placementResult = await this.retryOperation(
            () =>
              this.orderService.placeMarketOrder(
                config.symbol,
                side,
                config.orderSize,
                config.transportType,
                fillCallback,
              ),
            config.maxRetries || 3,
            config.retryBaseDelay || 1000,
            `Market order placement for ${config.symbol}`,
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

          placementResult = await this.retryOperation(
            () =>
              this.orderService.placeLimitOrder(
                config.symbol,
                side,
                config.orderSize,
                requestedPrice!,
                config.transportType,
                fillCallback,
              ),
            config.maxRetries || 3,
            config.retryBaseDelay || 1000,
            `Limit order placement for ${config.symbol}`,
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

          placementResult = await this.retryOperation(
            () =>
              this.orderService.placePostOnlyOrder(
                config.symbol,
                side,
                config.orderSize,
                requestedPrice!,
                config.transportType,
                fillCallback,
              ),
            config.maxRetries || 3,
            config.retryBaseDelay || 1000,
            `Post-only order placement for ${config.symbol}`,
          );

          // If cancel latency testing is enabled, cancel the order synchronously and measure latency
          if (
            config.testCancelLatency &&
            placementResult.success &&
            placementResult.orderId
          ) {
            const delayCancelAfter = config.delayCancelAfterPlacement || 2000;
            this.logger.log(
              `Waiting ${delayCancelAfter}ms before canceling order ${placementResult.orderId}`,
            );

            // Wait for the order to be fully placed on the exchange
            await this.sleep(delayCancelAfter);

            // Execute cancel operation synchronously and capture metrics with retry
            try {
              cancelMetrics = await this.retryOperation(
                () =>
                  this.executeCancelOperation(
                    config.symbol,
                    placementResult.orderId,
                    orderIndex,
                  ),
                config.maxRetries || 3,
                config.retryBaseDelay || 1000,
                `Cancel operation for order ${placementResult.orderId}`,
              );
            } catch (error) {
              this.logger.error(
                `Failed to cancel order ${placementResult.orderId} after retries:`,
                error,
              );
            }
          }
          break;
        }

        default:
          throw new Error(
            `Unsupported order type: ${config.orderType as string}`,
          );
      }

      // Wait for fill or timeout (only for successful order placements and when not testing cancel latency)
      if (
        placementResult.success &&
        config.orderType !== OrderType.POST_ONLY &&
        !config.testCancelLatency
      ) {
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

      // Add cancel data if it was captured during execution
      if (cancelMetrics && typeof cancelMetrics === 'object') {
        Object.assign(metrics, {
          cancelSentTime: cancelMetrics.cancelSentTime,
          cancelReturnedTime: cancelMetrics.cancelReturnedTime,
          cancelSuccess: cancelMetrics.cancelSuccess,
          cancelErrorMessage: cancelMetrics.cancelErrorMessage,
          cancelSendToReturnLatency: cancelMetrics.cancelSendToReturnLatency,
          cancelNotificationTime: cancelMetrics.cancelNotificationTime,
          cancelReturnToNotificationLatency:
            cancelMetrics.cancelReturnToNotificationLatency,
          cancelSendToNotificationLatency:
            cancelMetrics.cancelSendToNotificationLatency,
        });
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

    // Calculate cancel latency statistics
    const ordersWithCancelData = result.orders.filter(
      (order) => order.cancelSendToReturnLatency !== undefined,
    );

    if (ordersWithCancelData.length > 0) {
      const successfulCancels = ordersWithCancelData.filter(
        (order) => order.cancelSuccess === true,
      );
      const failedCancels = ordersWithCancelData.filter(
        (order) => order.cancelSuccess === false,
      );

      result.totalSuccessfulCancels = successfulCancels.length;
      result.totalFailedCancels = failedCancels.length;
      result.cancelSuccessRate =
        ordersWithCancelData.length > 0
          ? (successfulCancels.length / ordersWithCancelData.length) * 100
          : 0;

      // Calculate cancel send-to-return latencies
      const cancelSendToReturnLatencies = successfulCancels
        .map((order) => order.cancelSendToReturnLatency!)
        .sort((a, b) => a - b);

      if (cancelSendToReturnLatencies.length > 0) {
        result.avgCancelSendToReturnLatency =
          cancelSendToReturnLatencies.reduce((a, b) => a + b, 0) /
          cancelSendToReturnLatencies.length;
        result.minCancelSendToReturnLatency = cancelSendToReturnLatencies[0];
        result.maxCancelSendToReturnLatency =
          cancelSendToReturnLatencies[cancelSendToReturnLatencies.length - 1];
        result.p50CancelSendToReturnLatency = this.getPercentile(
          cancelSendToReturnLatencies,
          50,
        );
        result.p95CancelSendToReturnLatency = this.getPercentile(
          cancelSendToReturnLatencies,
          95,
        );
        result.p99CancelSendToReturnLatency = this.getPercentile(
          cancelSendToReturnLatencies,
          99,
        );
      }

      // Calculate cancel send-to-notification latencies (WebSocket)
      const cancelSendToNotificationLatencies = successfulCancels
        .filter((order) => order.cancelSendToNotificationLatency !== undefined)
        .map((order) => order.cancelSendToNotificationLatency!)
        .sort((a, b) => a - b);

      if (cancelSendToNotificationLatencies.length > 0) {
        result.avgCancelSendToNotificationLatency =
          cancelSendToNotificationLatencies.reduce((a, b) => a + b, 0) /
          cancelSendToNotificationLatencies.length;
        result.minCancelSendToNotificationLatency =
          cancelSendToNotificationLatencies[0];
        result.maxCancelSendToNotificationLatency =
          cancelSendToNotificationLatencies[
            cancelSendToNotificationLatencies.length - 1
          ];
        result.p50CancelSendToNotificationLatency = this.getPercentile(
          cancelSendToNotificationLatencies,
          50,
        );
        result.p95CancelSendToNotificationLatency = this.getPercentile(
          cancelSendToNotificationLatencies,
          95,
        );
        result.p99CancelSendToNotificationLatency = this.getPercentile(
          cancelSendToNotificationLatencies,
          99,
        );
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

    // Add cancel latency metrics if available
    if (
      result.totalSuccessfulCancels !== undefined &&
      result.totalSuccessfulCancels > 0
    ) {
      summary.push(
        '',
        'CANCEL LATENCY METRICS (Send to Return):',
        `Cancel Success Rate: ${result.cancelSuccessRate!.toFixed(2)}%`,
        `Successful Cancels: ${result.totalSuccessfulCancels}`,
        `Failed Cancels: ${result.totalFailedCancels || 0}`,
        `Average: ${result.avgCancelSendToReturnLatency!.toFixed(2)}ms`,
        `Min: ${result.minCancelSendToReturnLatency!}ms`,
        `Max: ${result.maxCancelSendToReturnLatency!}ms`,
        `P50: ${result.p50CancelSendToReturnLatency!.toFixed(2)}ms`,
        `P95: ${result.p95CancelSendToReturnLatency!.toFixed(2)}ms`,
        `P99: ${result.p99CancelSendToReturnLatency!.toFixed(2)}ms`,
      );

      // Add WebSocket notification metrics if available
      if (result.avgCancelSendToNotificationLatency !== undefined) {
        summary.push(
          '',
          'CANCEL NOTIFICATION LATENCY METRICS (Send to Notification):',
          `Average: ${result.avgCancelSendToNotificationLatency.toFixed(2)}ms`,
          `Min: ${result.minCancelSendToNotificationLatency!}ms`,
          `Max: ${result.maxCancelSendToNotificationLatency!}ms`,
          `P50: ${result.p50CancelSendToNotificationLatency!.toFixed(2)}ms`,
          `P95: ${result.p95CancelSendToNotificationLatency!.toFixed(2)}ms`,
          `P99: ${result.p99CancelSendToNotificationLatency!.toFixed(2)}ms`,
        );
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
      maxRetries: 3,
      retryBaseDelay: 1000,
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

  /**
   * Run a post-only benchmark with cancel latency testing
   * This places post-only orders and then cancels them to measure both placement and cancel latencies
   */
  async runPostOnlyWithCancelBenchmark(
    transportType: TransportType = TransportType.HTTP,
    numberOfOrders: number = 5,
    delayCancelAfterPlacement: number = 2000,
  ): Promise<BenchmarkResult> {
    const config = this.createDefaultConfig({
      orderType: OrderType.POST_ONLY,
      transportType,
      numberOfOrders,
      testCancelLatency: true,
      delayCancelAfterPlacement,
      delayBetweenOrders: 3000, // Longer delay to allow for cancel operations
    });

    this.logger.log(
      `Starting post-only + cancel latency benchmark: ${numberOfOrders} orders, ` +
        `${delayCancelAfterPlacement}ms delay before cancel`,
    );

    return this.runBenchmark(config);
  }

  /**
   * Compare market order fill latency vs post-only + cancel latency
   * This validates the hypothesis that cancel operations are faster than market order fills
   * due to Hyperliquid's order prioritization system
   */
  async compareMarketVsCancel(
    transportType: TransportType = TransportType.HTTP,
    numberOfOrders: number = 5,
  ): Promise<{
    market: BenchmarkResult;
    postOnlyWithCancel: BenchmarkResult;
    analysis: {
      avgMarketFillLatency: number;
      avgCancelLatency: number;
      latencyDifference: number;
      speedupFactor: number;
    };
  }> {
    this.logger.log('Starting market vs cancel latency comparison...');

    // Run market order benchmark
    const marketConfig = this.createDefaultConfig({
      orderType: OrderType.MARKET,
      transportType,
      numberOfOrders,
      delayBetweenOrders: 2000,
    });

    const marketResult = await this.runBenchmark(marketConfig);

    // Wait between benchmarks
    await this.sleep(3000);

    // Run post-only + cancel benchmark
    const postOnlyResult = await this.runPostOnlyWithCancelBenchmark(
      transportType,
      numberOfOrders,
      2000,
    );

    // Analyze results
    const avgMarketFillLatency =
      marketResult.avgSendToFillLatency || marketResult.avgSendToReturnLatency;
    const avgCancelLatency = postOnlyResult.avgCancelSendToReturnLatency || 0;
    const latencyDifference = avgMarketFillLatency - avgCancelLatency;
    const speedupFactor =
      avgCancelLatency > 0 ? avgMarketFillLatency / avgCancelLatency : 0;

    const analysis = {
      avgMarketFillLatency,
      avgCancelLatency,
      latencyDifference,
      speedupFactor,
    };

    this.logMarketVsCancelComparison(marketResult, postOnlyResult, analysis);

    return {
      market: marketResult,
      postOnlyWithCancel: postOnlyResult,
      analysis,
    };
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

  private logMarketVsCancelComparison(
    marketResult: BenchmarkResult,
    cancelResult: BenchmarkResult,
    analysis: {
      avgMarketFillLatency: number;
      avgCancelLatency: number;
      latencyDifference: number;
      speedupFactor: number;
    },
  ): void {
    const comparison = [
      '='.repeat(80),
      'MARKET ORDER VS CANCEL ORDER LATENCY COMPARISON',
      '='.repeat(80),
      '',
      'HYPOTHESIS VALIDATION:',
      'Testing if cancel orders execute faster than market orders due to',
      "Hyperliquid's order prioritization (cancels/post-only > GTC/IOC)",
      '',
      'MARKET ORDER RESULTS:',
      `  Success Rate: ${marketResult.successRate.toFixed(2)}%`,
      `  Average Fill Latency: ${analysis.avgMarketFillLatency.toFixed(2)}ms`,
      `  P50 Fill Latency: ${(marketResult.p50SendToFillLatency || marketResult.p50SendToReturnLatency).toFixed(2)}ms`,
      `  P95 Fill Latency: ${(marketResult.p95SendToFillLatency || marketResult.p95SendToReturnLatency).toFixed(2)}ms`,
      '',
      'CANCEL ORDER RESULTS:',
      `  Cancel Success Rate: ${(cancelResult.cancelSuccessRate || 0).toFixed(2)}%`,
      `  Average Cancel Latency: ${analysis.avgCancelLatency.toFixed(2)}ms`,
      `  P50 Cancel Latency: ${(cancelResult.p50CancelSendToReturnLatency || 0).toFixed(2)}ms`,
      `  P95 Cancel Latency: ${(cancelResult.p95CancelSendToReturnLatency || 0).toFixed(2)}ms`,
      '',
      'ANALYSIS:',
      `  Market Fill Latency: ${analysis.avgMarketFillLatency.toFixed(2)}ms`,
      `  Cancel Latency: ${analysis.avgCancelLatency.toFixed(2)}ms`,
      `  Latency Difference: ${analysis.latencyDifference.toFixed(2)}ms`,
      `  Speedup Factor: ${analysis.speedupFactor.toFixed(2)}x`,
    ];

    if (analysis.latencyDifference > 100) {
      comparison.push(
        '',
        '✓ HYPOTHESIS SUPPORTED:',
        `Cancel orders are ${analysis.latencyDifference.toFixed(0)}ms faster than market orders`,
        'This suggests the API queue prioritizes cancel/post-only orders over market orders',
        'The bottleneck in market order fills appears to be API queue prioritization',
      );
    } else {
      comparison.push(
        '',
        '✗ HYPOTHESIS NOT SUPPORTED:',
        'Cancel and market order latencies are similar',
        'The bottleneck may be elsewhere (network, blockchain, etc.)',
      );
    }

    comparison.push('='.repeat(80));
    this.logger.log(comparison.join('\n'));
  }

  /**
   * Execute a cancel operation and return the cancel metrics
   * This is called synchronously during order execution for accurate timing
   */
  private async executeCancelOperation(
    symbol: string,
    orderId: string,
    orderIndex: number,
  ): Promise<{
    cancelSentTime: number;
    cancelReturnedTime: number;
    cancelSuccess: boolean;
    cancelErrorMessage?: string;
    cancelSendToReturnLatency: number;
    cancelNotificationTime?: number;
    cancelReturnToNotificationLatency?: number;
    cancelSendToNotificationLatency?: number;
  } | null> {
    this.logger.log(
      `Canceling order ${orderId} for latency testing (order ${orderIndex + 1})`,
    );

    let cancelResult: OrderCancelResult | null = null;

    const cancelCallback = (result: OrderCancelResult) => {
      cancelResult = result;
    };

    try {
      const cancelPlacementResult = await this.orderService.cancelOrder(
        symbol,
        orderId,
        cancelCallback,
      );

      // Wait a short time for WebSocket notification (if implemented)
      await this.sleep(200);

      const metrics = {
        cancelSentTime: cancelPlacementResult.cancelSentTime,
        cancelReturnedTime: cancelPlacementResult.cancelReturnedTime,
        cancelSuccess: cancelPlacementResult.success,
        cancelErrorMessage: cancelPlacementResult.errorMessage,
        cancelSendToReturnLatency:
          cancelPlacementResult.cancelReturnedTime -
          cancelPlacementResult.cancelSentTime,
      };

      // Add WebSocket notification data if available
      if (
        cancelResult &&
        typeof cancelResult === 'object' &&
        'notificationTime' in cancelResult
      ) {
        const result = cancelResult as OrderCancelResult;
        Object.assign(metrics, {
          cancelNotificationTime: result.notificationTime,
          cancelReturnToNotificationLatency:
            result.notificationTime - cancelPlacementResult.cancelReturnedTime,
          cancelSendToNotificationLatency:
            result.notificationTime - cancelPlacementResult.cancelSentTime,
        });
      }

      this.logger.log(
        `Cancel operation completed for order ${orderId}: ` +
          `API latency ${metrics.cancelSendToReturnLatency}ms, ` +
          `Success: ${cancelPlacementResult.success}`,
      );

      return metrics;
    } catch (error) {
      this.logger.error(
        `Failed to cancel order ${orderId} for latency testing:`,
        error,
      );
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      'rate limit exceeded',
    ];

    return !permanentErrors.some((permError) => message.includes(permError));
  }

  /**
   * Retry an operation with exponential backoff
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000,
    operationName: string = 'operation',
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this error should be retried
        if (!this.shouldRetryError(error as Error)) {
          this.logger.error(
            `${operationName} failed with permanent error, not retrying:`,
            lastError.message,
          );
          throw lastError;
        }

        if (attempt === maxRetries) {
          this.logger.error(
            `${operationName} failed after ${maxRetries} attempts:`,
            lastError.message,
          );
          break;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        this.logger.warn(
          `${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`,
          lastError.message,
        );

        await this.sleep(delay);
      }
    }

    throw lastError || new Error(`${operationName} failed after retries`);
  }
}
