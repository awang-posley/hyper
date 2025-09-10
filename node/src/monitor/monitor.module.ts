import { Module } from '@nestjs/common';
import { MonitorService } from './monitor.service';

@Module({
  providers: [MonitorService],
})
export class MonitorModule {}
