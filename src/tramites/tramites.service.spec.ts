import { Test, TestingModule } from '@nestjs/testing';
import { TramitesService } from './tramites.service';

describe('TramitesService', () => {
  let service: TramitesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TramitesService],
    }).compile();

    service = module.get<TramitesService>(TramitesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
