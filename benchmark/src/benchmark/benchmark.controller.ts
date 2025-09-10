import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { BenchService } from '../bench/bench.service';
import type {
  BenchmarkConfig,
  BenchmarkResult,
} from '../common/interfaces/benchmark.interface';
import {
  OrderType,
  TransportType,
} from '../common/interfaces/benchmark.interface';

@Controller('benchmark')
export class BenchmarkController {
  constructor(private readonly benchService: BenchService) {}

  @Post('run')
  async runBenchmark(
    @Body() config: BenchmarkConfig,
  ): Promise<BenchmarkResult> {
    return this.benchService.runBenchmark(config);
  }

  @Post('quick')
  async runQuickBenchmark(
    @Query('orderType') orderType: OrderType = OrderType.MARKET,
    @Query('transportType') transportType: TransportType = TransportType.HTTP,
    @Query('numberOfOrders') numberOfOrders: number = 5,
  ): Promise<BenchmarkResult> {
    return this.benchService.runQuickBenchmark(
      orderType,
      transportType,
      numberOfOrders,
    );
  }

  @Post('compare-transports')
  async compareTransports(
    @Body() config: Omit<BenchmarkConfig, 'transportType'>,
  ): Promise<{ http: BenchmarkResult; websocket: BenchmarkResult }> {
    return this.benchService.compareTransports(config);
  }

  @Get('status')
  getStatus(): { isRunning: boolean; currentResult: BenchmarkResult | null } {
    return {
      isRunning: this.benchService.isBenchmarkRunning(),
      currentResult: this.benchService.getCurrentBenchmarkResult(),
    };
  }

  @Get('default-config')
  getDefaultConfig(): BenchmarkConfig {
    return this.benchService.createDefaultConfig();
  }
}
