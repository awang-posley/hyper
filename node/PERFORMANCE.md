# Performance Tuning Guide

## Overview

This guide provides recommendations for optimizing the Hyperliquid Node Trade Monitor for the lowest possible latency.

## System Requirements

- **CPU**: Modern multi-core processor (4+ cores recommended)
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: SSD required for optimal file I/O performance
- **Network**: Low-latency connection to Hyperliquid validators

## Linux Kernel Tuning

Add these settings to `/etc/sysctl.conf`:

```bash
# Increase file descriptor limits
fs.file-max = 1000000
fs.nr_open = 1000000

# Optimize for low latency
kernel.sched_latency_ns = 1000000
kernel.sched_min_granularity_ns = 100000
kernel.sched_wakeup_granularity_ns = 25000

# Network optimizations
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728

# Disable swap for consistent performance
vm.swappiness = 0
```

Apply with: `sudo sysctl -p`

## File System Optimizations

1. **Use ext4 or XFS** for the data directory
2. **Mount with noatime** to reduce unnecessary writes:
   ```bash
   # In /etc/fstab
   /dev/sda1 /home/awang/hl ext4 defaults,noatime 0 2
   ```

3. **Disable file system barriers** (only if you have battery-backed storage):
   ```bash
   mount -o remount,nobarrier /home/awang/hl
   ```

## Application Tuning

1. **Node.js Flags**:
   ```bash
   # Add to your start script
   node --max-old-space-size=4096 --optimize-for-size dist/main
   ```

2. **Process Priority**:
   ```bash
   # Run with high priority
   sudo nice -n -10 npm run start:prod
   ```

3. **CPU Affinity**:
   ```bash
   # Pin to specific CPU cores
   taskset -c 0,1 npm run start:prod
   ```

## Monitoring Configuration

1. **Reduce Stats Interval** for more frequent updates:
   ```env
   STATS_INTERVAL_MS=60000  # 1 minute instead of 5
   ```

2. **Increase Buffer Size** for high-volume trading:
   ```env
   MAX_RECORDS_TO_KEEP=5000  # Keep more records in memory
   ```

## System Monitoring

Monitor system performance with:

```bash
# CPU usage
htop

# Disk I/O
iotop

# File system activity
inotifywatch -v -r ~/hl/data/node_trades/hourly

# Application metrics
curl http://localhost:3002/trades/stats
```

## Latency Benchmarks

Expected latencies on optimized systems:

- **P50**: 5-10ms
- **P95**: 15-25ms
- **P99**: 30-50ms

Factors affecting latency:
1. Disk I/O speed
2. CPU load
3. File system cache
4. Node process scheduling

## Troubleshooting High Latency

1. **Check Disk Performance**:
   ```bash
   dd if=/dev/zero of=test.dat bs=1M count=1000 oflag=direct
   ```

2. **Monitor inotify Events**:
   ```bash
   # Check inotify limits
   cat /proc/sys/fs/inotify/max_user_watches
   
   # Increase if needed
   echo 524288 | sudo tee /proc/sys/fs/inotify/max_user_watches
   ```

3. **Profile Node.js**:
   ```bash
   node --prof dist/main
   node --prof-process isolate-*.log > profile.txt
   ```

## Production Checklist

- [ ] System tuning applied
- [ ] File system optimized
- [ ] Process priority set
- [ ] Monitoring configured
- [ ] Systemd service installed
- [ ] Log rotation configured
- [ ] Backups scheduled
- [ ] Alerts configured
