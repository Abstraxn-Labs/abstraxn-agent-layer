import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    controller = module.get(AppController);
  });

  it('returns the expected health check shape', () => {
    const result = controller.getHealth();
    expect(result).toEqual(
      expect.objectContaining({
        error: false,
        message: 'Abstraxn Public Web3 MCP Service',
        port: expect.any(String),
        timestamp: expect.any(Number),
        up_since_in_sec: expect.any(Number),
      }),
    );
  });
});
