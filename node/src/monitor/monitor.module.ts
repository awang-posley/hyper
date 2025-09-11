import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { MonitorService } from './monitor.service';

@Module({
  imports: [ConfigModule, ScheduleModule],
  providers: [MonitorService],
  exports: [MonitorService],
})
export class MonitorModule {}
