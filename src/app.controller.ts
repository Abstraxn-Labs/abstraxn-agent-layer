import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/health')
  @SkipThrottle()
  @ApiOperation({ summary: 'Liveness / readiness style health check' })
  @ApiOkResponse({
    description: 'Service is running',
    schema: {
      type: 'object',
      properties: {
        error: { type: 'boolean', example: false },
        message: { type: 'string' },
        port: { type: 'string' },
        timestamp: { type: 'number' },
        up_since_in_sec: { type: 'number' },
      },
    },
  })
  getHealth() {
    const port = process.env.PORT || '3011';
    return this.appService.getHealthCheck(port);
  }
}
