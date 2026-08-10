import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private readonly startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  getUptime(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  getHealthCheck(port: string) {
    return {
      error: false,
      message: 'Abstraxn Public Web3 MCP Service',
      port,
      timestamp: Date.now(),
      up_since_in_sec: this.getUptime(),
    };
  }
}
