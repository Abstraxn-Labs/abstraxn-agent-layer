import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { IpTrackingService } from './ip-tracking.service';
import { ObservedIp } from '../entities/observed-ip.entity';

describe('IpTrackingService', () => {
  let service: IpTrackingService;
  let observedIpRepo: jest.Mocked<Pick<Repository<ObservedIp>, 'query'>>;

  beforeEach(async () => {
    observedIpRepo = { query: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpTrackingService,
        { provide: getRepositoryToken(ObservedIp), useValue: observedIpRepo },
      ],
    }).compile();

    service = module.get(IpTrackingService);
  });

  it('does nothing when no IP is available', async () => {
    await service.recordHit(undefined);
    await service.recordHit(null);
    await service.recordHit('');
    expect(observedIpRepo.query).not.toHaveBeenCalled();
  });

  it('upserts the IP with an atomic increment, not a naive overwrite', async () => {
    await service.recordHit('203.0.113.9');

    expect(observedIpRepo.query).toHaveBeenCalledTimes(1);
    const [sql, params] = observedIpRepo.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('"callCount" + 1');
    expect(params).toEqual(['203.0.113.9']);
  });

  it('issues the upsert once per hit, including on a repeat IP', async () => {
    await service.recordHit('203.0.113.9');
    await service.recordHit('203.0.113.9');

    expect(observedIpRepo.query).toHaveBeenCalledTimes(2);
  });

  it('catches and logs a repository failure without rejecting', async () => {
    observedIpRepo.query.mockRejectedValueOnce(new Error('db down'));

    await expect(service.recordHit('203.0.113.9')).resolves.toBeUndefined();
  });
});
