import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { MonitorService, TradeRecord, LatencyStats } from './monitor/monitor.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly monitorService: MonitorService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('trades/recent')
  getRecentTrades(@Query('limit') limit?: string): {
    trades: TradeRecord[];
    totalCount: number;
  } {
    const tradeLimit = limit ? parseInt(limit, 10) : 10;
    return {
      trades: this.monitorService.getRecentTrades(tradeLimit),
      totalCount: this.monitorService.getTotalTradeCount(),
    };
  }

  @Get('trades/stats')
  getTradeStats(): {
    latencyStats: LatencyStats;
    totalTrades: number;
  } {
    return {
      latencyStats: this.monitorService.getLatencyStats(),
      totalTrades: this.monitorService.getTotalTradeCount(),
    };
  }
}
