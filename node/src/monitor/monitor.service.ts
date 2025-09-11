import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

interface Trade {
  coin: string;
  side: 'B' | 'S';
  time: string;
  px: string;
  sz: string;
  hash: string;
  trade_dir_override: string;
  side_info: Array<{
    user: string;
    start_pos: string;
    oid: number;
    twap_id: number | null;
    cloid: string | null;
  }>;
}

export interface TradeRecord {
  trade: Trade;
  detectedAt: number;
  tradeTimestamp: number;
  detectionLatency: number;
}

export interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  count: number;
}

@Injectable()
export class MonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitorService.name);
  private watcher: chokidar.FSWatcher | null = null;
  private readonly tradeRecords: TradeRecord[] = [];
  private filePosition = new Map<string, number>();
  private currentHour: number = -1;
  private currentDate: string = '';
  private statsInterval: NodeJS.Timeout | null = null;
  private readonly readFileAsync = promisify(fs.readFile);
  private readonly statAsync = promisify(fs.stat);

  // Configuration
  private readonly monitoredAddresses: Set<string>;
  private readonly dataPath: string;
  private readonly statsIntervalMs: number;
  private readonly maxRecordsToKeep: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    // Load configuration
    const addresses = this.configService.get<string>('MONITOR_ADDRESSES', '');
    this.monitoredAddresses = new Set(
      addresses
        .split(',')
        .map((addr) => addr.trim().toLowerCase())
        .filter((addr) => addr.startsWith('0x')),
    );

    this.dataPath = this.configService.get<string>(
      'NODE_DATA_PATH',
      path.join(
        process.env.HOME || '/home/awang',
        'hl/data/node_trades/hourly',
      ),
    );

    this.statsIntervalMs = this.configService.get<number>(
      'STATS_INTERVAL_MS',
      300000,
    ); // 5 minutes
    this.maxRecordsToKeep = this.configService.get<number>(
      'MAX_RECORDS_TO_KEEP',
      1000,
    );

    if (this.monitoredAddresses.size === 0) {
      this.logger.warn(
        'No addresses configured for monitoring. Set MONITOR_ADDRESSES env variable.',
      );
    }

    this.logger.log(
      `Monitoring addresses: ${Array.from(this.monitoredAddresses).join(', ')}`,
    );
    this.logger.log(`Data path: ${this.dataPath}`);
  }

  async onModuleInit() {
    await this.startMonitoring();
    this.startStatsReporting();
  }

  async onModuleDestroy() {
    await this.stopMonitoring();
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
  }

  private async startMonitoring() {
    try {
      // Ensure data directory exists
      if (!fs.existsSync(this.dataPath)) {
        this.logger.error(`Data path does not exist: ${this.dataPath}`);
        return;
      }

      // Start monitoring current hour file
      await this.updateCurrentHourFile();

      // Set up periodic check for hour change (every minute)
      setInterval(() => {
        this.checkForHourChange().catch((error) =>
          this.logger.error('Error checking for hour change:', error),
        );
      }, 60000); // Check every minute

      this.logger.log('Trade monitoring started');
    } catch (error) {
      this.logger.error('Failed to start monitoring:', error);
    }
  }

  private async stopMonitoring() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.logger.log('Trade monitoring stopped');
  }

  private async updateCurrentHourFile() {
    const now = new Date();
    const dateStr = this.formatDateForPath(now);
    const hour = now.getUTCHours();
    const filePath = path.join(this.dataPath, dateStr, hour.toString());

    // Check if we're already watching the correct file
    if (this.currentDate === dateStr && this.currentHour === hour) {
      return; // Already watching the correct file
    }

    // Stop watching previous file if exists
    if (this.watcher) {
      await this.watcher.close();
    }

    this.currentDate = dateStr;
    this.currentHour = hour;

    // Always start from the END of the file to monitor only new trades
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const startPosition = stats.size;
      this.filePosition.set(filePath, startPosition);

      this.logger.log(
        `Monitoring current hour file: ${filePath} ` +
          `(starting from position ${startPosition})`,
      );
    } else {
      this.logger.log(
        `Waiting for current hour file to be created: ${filePath}`,
      );
      // File doesn't exist yet, will start from position 0 when created
      this.filePosition.set(filePath, 0);
    }

    // Watch only the current hour's file
    this.watcher = chokidar.watch(filePath, {
      persistent: true,
      ignoreInitial: false, // Need to detect changes to existing file
      awaitWriteFinish: false, // Disable to get real-time updates
      usePolling: true, // Use polling for better detection
      interval: 100, // Poll every 100ms
    });

    this.watcher
      .on('add', (filePath) => {
        this.logger.log(`Current hour file created: ${filePath}`);
        // For new files that didn't exist before, start from beginning
        if (!this.filePosition.has(filePath)) {
          this.filePosition.set(filePath, 0);
        }
      })
      .on('change', (filePath) => {
        this.handleFileChange(filePath).catch((error) =>
          this.logger.error('Error handling file change:', error),
        );
      })
      .on('error', (error) => this.logger.error('Watcher error:', error));
  }

  private async checkForHourChange() {
    const now = new Date();
    const dateStr = this.formatDateForPath(now);
    const hour = now.getUTCHours();

    // If hour has changed, update the watched file
    if (this.currentDate !== dateStr || this.currentHour !== hour) {
      this.logger.log(
        `Hour changed from ${this.currentDate}/${this.currentHour} to ${dateStr}/${hour}`,
      );
      await this.updateCurrentHourFile();
    }
  }

  private formatDateForPath(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  // Remove handleFileAdd as we no longer need it with the new approach

  private async handleFileChange(filePath: string) {
    const lastPosition = this.filePosition.get(filePath) || 0;
    // Only log debug if we're actually processing new data
    await this.processFile(filePath, lastPosition);
  }

  private isTradeFile(filePath: string): boolean {
    // Check if it's a trade file (numeric filename in a date directory)
    const basename = path.basename(filePath);
    const dirname = path.basename(path.dirname(filePath));

    return /^\d+$/.test(basename) && /^\d{8}$/.test(dirname);
  }

  private async processFile(filePath: string, startPosition: number) {
    try {
      const stats = await this.statAsync(filePath);
      const fileSize = stats.size;

      if (fileSize <= startPosition) {
        return; // No new data
      }

      // Read the new portion of the file
      const buffer = Buffer.alloc(fileSize - startPosition);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, buffer.length, startPosition);
      fs.closeSync(fd);

      const newContent = buffer.toString('utf8');
      let tradesFound = 0;

      // Split by newlines and process each line
      const lines = newContent.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          const found = this.processTradeLine(line);
          if (found) tradesFound++;
        }
      }

      // Update file position to the new end
      this.filePosition.set(filePath, fileSize);

      if (tradesFound > 0) {
        this.logger.debug(
          `Processed ${fileSize - startPosition} new bytes from ${filePath}, ` +
            `found ${tradesFound} trades for monitored addresses`,
        );
      }
    } catch (error) {
      this.logger.error(`Error processing file ${filePath}:`, error);
    }
  }

  private processTradeLine(line: string): boolean {
    // detectedAt is in UTC
    const detectedAt = Date.now();
    const detectedAtUTC = new Date(detectedAt).getTime();
    let foundMonitoredAddress = false;

    try {
      const trade = JSON.parse(line) as Trade;

      // Removed debug logging for performance

      // Check if any monitored address is involved
      for (const sideInfo of trade.side_info) {
        const userLower = sideInfo.user.toLowerCase();
        if (this.monitoredAddresses.has(userLower)) {
          foundMonitoredAddress = true;

          // Parse trade timestamp
          // Truncate fractional seconds to 3 digits (milliseconds)
          const timeParts = trade.time.split('.');
          let utcTimeStr = trade.time;
          if (timeParts.length === 2) {
            const integerPart = timeParts[0];
            const fractionalPart = timeParts[1].substring(0, 3); // Take first 3 digits
            utcTimeStr = `${integerPart}.${fractionalPart}`;
          }

          // Append 'Z' to force UTC parsing
          const tradeTimestamp = new Date(`${utcTimeStr}Z`).getTime();
          const detectionLatency = detectedAtUTC - tradeTimestamp;

          // Skip very old trades (more than 1 hour old)
          // This prevents processing historical data when the service starts
          if (detectionLatency > 3600000) {
            // 1 hour in milliseconds
            this.logger.debug(
              `Skipping old trade for ${userLower}: trade time ${trade.time}, latency ${detectionLatency}ms`,
            );
            continue;
          }

          const record: TradeRecord = {
            trade,
            detectedAt,
            tradeTimestamp,
            detectionLatency,
          };

          this.tradeRecords.push(record);

          // Log immediate detection with more detail
          this.logger.log(
            `🎯 TRADE DETECTED for ${sideInfo.user}: ` +
              `${trade.coin} ${trade.side === 'B' ? 'BUY' : 'SELL'} ` +
              `${trade.sz} @ ${trade.px} ` +
              `at ${trade.time} ` +
              `(latency: ${detectionLatency}ms)`,
          );

          // Maintain record limit
          if (this.tradeRecords.length > this.maxRecordsToKeep) {
            this.tradeRecords.shift();
          }

          break; // Only record once per trade even if multiple monitored addresses
        }
      }
    } catch (error) {
      this.logger.error(
        `Error parsing trade line: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.logger.debug(`Problematic line: ${line.substring(0, 100)}...`);
    }

    return foundMonitoredAddress;
  }

  private startStatsReporting() {
    this.statsInterval = setInterval(() => {
      this.logStatistics();
    }, this.statsIntervalMs);

    this.schedulerRegistry.addInterval('trade-stats', this.statsInterval);
  }

  private logStatistics() {
    if (this.tradeRecords.length === 0) {
      this.logger.log('No trades recorded yet for monitored addresses');
      return;
    }

    // Get last 10 trades
    const recentTrades = this.tradeRecords.slice(-10);

    // Calculate latency statistics
    const latencies = this.tradeRecords
      .map((r) => r.detectionLatency)
      .sort((a, b) => a - b);
    const stats = this.calculateLatencyStats(latencies);

    this.logger.log('='.repeat(80));
    this.logger.log('TRADE MONITORING STATISTICS');
    this.logger.log('='.repeat(80));
    this.logger.log(`Total trades recorded: ${this.tradeRecords.length}`);
    this.logger.log('');

    this.logger.log('LATENCY STATISTICS (Detection time - Trade time):');
    this.logger.log(`  Min: ${stats.min}ms`);
    this.logger.log(`  Max: ${stats.max}ms`);
    this.logger.log(`  Average: ${stats.avg.toFixed(2)}ms`);
    this.logger.log(`  P50: ${stats.p50}ms`);
    this.logger.log(`  P95: ${stats.p95}ms`);
    this.logger.log(`  P99: ${stats.p99}ms`);
    this.logger.log('');

    this.logger.log('LAST 10 TRADES:');
    recentTrades.forEach((record, index) => {
      const trade = record.trade;
      const userInfo = trade.side_info.find((si) =>
        this.monitoredAddresses.has(si.user.toLowerCase()),
      );

      this.logger.log(
        `  ${index + 1}. ${new Date(trade.time).toISOString()} - ` +
          `${trade.coin} ${trade.side === 'B' ? 'BUY' : 'SELL'} ` +
          `${trade.sz} @ ${trade.px} ` +
          `(user: ${userInfo?.user.substring(0, 10)}..., ` +
          `latency: ${record.detectionLatency}ms)`,
      );
    });

    this.logger.log('='.repeat(80));
  }

  private calculateLatencyStats(sortedLatencies: number[]): LatencyStats {
    const count = sortedLatencies.length;

    if (count === 0) {
      return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, count: 0 };
    }

    const sum = sortedLatencies.reduce((a, b) => a + b, 0);

    return {
      min: sortedLatencies[0],
      max: sortedLatencies[count - 1],
      avg: sum / count,
      p50: this.getPercentile(sortedLatencies, 50),
      p95: this.getPercentile(sortedLatencies, 95),
      p99: this.getPercentile(sortedLatencies, 99),
      count,
    };
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

  // Public methods for external access
  getRecentTrades(limit: number = 10): TradeRecord[] {
    return this.tradeRecords.slice(-limit);
  }

  getLatencyStats(): LatencyStats {
    const latencies = this.tradeRecords
      .map((r) => r.detectionLatency)
      .sort((a, b) => a - b);
    return this.calculateLatencyStats(latencies);
  }

  getTotalTradeCount(): number {
    return this.tradeRecords.length;
  }
}
