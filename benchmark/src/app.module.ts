import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OrderService } from './order/order.service';
import { BenchService } from './bench/bench.service';
import { BenchmarkController } from './benchmark/benchmark.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [AppController, BenchmarkController],
  providers: [AppService, OrderService, BenchService],
})
export class AppModule {}
