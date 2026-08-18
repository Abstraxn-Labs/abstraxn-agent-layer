import { ConfigService } from '@nestjs/config';
import { execute, registerPlacesLookupTool } from './places-lookup.tool';
import * as x402Relay from '../utils/x402-relay.util';
import { WalletTrackingService } from '../services/wallet-tracking.service';

function createConfig(): ConfigService {
  return {
    get: (_key: string, defaultValue?: string) => defaultValue ?? '',
  } as ConfigService;
}

function createWalletTrackingMock() {
  return { recordPaidCall: jest.fn().mockResolvedValue(undefined) };
}

function asWalletTrackingService(
  mock: ReturnType<typeof createWalletTrackingMock>,
): WalletTrackingService {
  return mock as unknown as WalletTrackingService;
}

describe('registerPlacesLookupTool', () => {
  it('registers under the places.lookup dot-notation name', () => {
    const server = { registerTool: jest.fn() };
    registerPlacesLookupTool(
      server as never,
      createConfig(),
      asWalletTrackingService(createWalletTrackingMock()),
    );
    expect(server.registerTool.mock.calls[0][0]).toBe('places.lookup');
  });

  it('never mentions an upstream vendor name in its own description', () => {
    const server = { registerTool: jest.fn() };
    registerPlacesLookupTool(
      server as never,
      createConfig(),
      asWalletTrackingService(createWalletTrackingMock()),
    );
    const config = server.registerTool.mock.calls[0][1] as {
      description: string;
    };
    expect(config.description).not.toMatch(
      /https?:\/\/|\b[a-z0-9-]+\.(app|com|io|xyz|dev|net)\b/i,
    );
    expect(config.description.toLowerCase()).not.toContain('stableenrich');
  });
});

describe('places.lookup execute', () => {
  const config = createConfig();
  let walletTracking: ReturnType<typeof createWalletTrackingMock>;
  let getSpy: jest.SpyInstance;
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    walletTracking = createWalletTrackingMock();
    getSpy = jest.spyOn(x402Relay, 'callEnrichmentRelayEndpoint');
    postSpy = jest.spyOn(x402Relay, 'callEnrichmentRelayEndpointJson');
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects text_search_full without textQuery', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'text_search_full',
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('rejects text_search_full with an out-of-range minRating', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'text_search_full',
        textQuery: 'coffee shops',
        minRating: 9,
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('dispatches text_search_full to POST /api/places/text-search/full', async () => {
    postSpy.mockResolvedValue({ status: 'ok', result: { places: [] } });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'text_search_full',
      textQuery: 'coffee shops in Brooklyn',
    });
    expect(postSpy).toHaveBeenCalledWith(
      config,
      '/api/places/text-search/full',
      expect.objectContaining({ textQuery: 'coffee shops in Brooklyn' }),
      { paymentPayload: undefined },
    );
  });

  it('dispatches text_search_partial to POST /api/places/text-search/partial', async () => {
    postSpy.mockResolvedValue({ status: 'ok', result: { places: [] } });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'text_search_partial',
      textQuery: 'coffee shops in Brooklyn',
    });
    expect(postSpy).toHaveBeenCalledWith(
      config,
      '/api/places/text-search/partial',
      expect.objectContaining({ textQuery: 'coffee shops in Brooklyn' }),
      { paymentPayload: undefined },
    );
  });

  it('rejects nearby_search_full without locationRestriction', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'nearby_search_full',
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('rejects nearby_search_full with a too-large radius', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'nearby_search_full',
        locationRestriction: {
          circle: {
            center: { latitude: 40.7, longitude: -73.9 },
            radius: 999999,
          },
        },
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('dispatches nearby_search_full to POST /api/places/nearby-search/full', async () => {
    postSpy.mockResolvedValue({ status: 'ok', result: { places: [] } });
    const locationRestriction = {
      circle: { center: { latitude: 40.7, longitude: -73.9 }, radius: 500 },
    };
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'nearby_search_full',
      locationRestriction,
    });
    expect(postSpy).toHaveBeenCalledWith(
      config,
      '/api/places/nearby-search/full',
      expect.objectContaining({ locationRestriction }),
      { paymentPayload: undefined },
    );
  });

  it('rejects place_details_full without placeId', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'place_details_full',
      },
    );
    expect(result.isError).toBe(true);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('rejects place_details_full with a placeholder-looking placeId', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'place_details_full',
        placeId: 'PLACEHOLDER_ID',
      },
    );
    expect(result.isError).toBe(true);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('dispatches place_details_full to GET /api/places/place-details/full', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: { displayName: 'Cafe' } });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'place_details_full',
      placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    });
    expect(getSpy).toHaveBeenCalledWith(
      config,
      '/api/places/place-details/full',
      expect.objectContaining({ placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }),
      { paymentPayload: undefined },
    );
  });

  it('rejects solar_building_insights without latitude/longitude', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'solar_building_insights',
      },
    );
    expect(result.isError).toBe(true);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('dispatches solar_building_insights to GET /api/places/solar/building-insights', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: {} });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'solar_building_insights',
      latitude: 37.4,
      longitude: -122.1,
    });
    expect(getSpy).toHaveBeenCalledWith(
      config,
      '/api/places/solar/building-insights',
      expect.objectContaining({ latitude: 37.4, longitude: -122.1 }),
      { paymentPayload: undefined },
    );
  });

  it('rejects solar_data_layers with an out-of-range radiusMeters', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'solar_data_layers',
        latitude: 37.4,
        longitude: -122.1,
        radiusMeters: 999,
      },
    );
    expect(result.isError).toBe(true);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('dispatches solar_data_layers to GET /api/places/solar/data-layers', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: {} });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'solar_data_layers',
      latitude: 37.4,
      longitude: -122.1,
    });
    expect(getSpy).toHaveBeenCalledWith(
      config,
      '/api/places/solar/data-layers',
      expect.objectContaining({ latitude: 37.4, longitude: -122.1 }),
      { paymentPayload: undefined },
    );
  });

  it('rejects solar_rgb_image when both id and coordinates are given', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'solar_rgb_image',
        id: 'geotiff_7f3a9c1e',
        latitude: 37.4,
        longitude: -122.1,
      },
    );
    expect(result.isError).toBe(true);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('rejects solar_rgb_image when neither id nor coordinates are given', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'solar_rgb_image',
      },
    );
    expect(result.isError).toBe(true);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('dispatches solar_rgb_image (Mode A, by id) to GET /api/places/solar/rgb-image', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: {} });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'solar_rgb_image',
      id: 'geotiff_7f3a9c1e',
    });
    expect(getSpy).toHaveBeenCalledWith(
      config,
      '/api/places/solar/rgb-image',
      expect.objectContaining({ id: 'geotiff_7f3a9c1e' }),
      { paymentPayload: undefined },
    );
  });

  it('rejects aerial_view_lookup_video when neither address nor videoId is given', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'aerial_view_lookup_video',
      },
    );
    expect(result.isError).toBe(true);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('rejects aerial_view_lookup_video when both address and videoId are given', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'aerial_view_lookup_video',
        address: '1600 Amphitheatre Parkway',
        videoId: 'vid_9f8a7b6c2d3e',
      },
    );
    expect(result.isError).toBe(true);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('dispatches aerial_view_lookup_video to GET /api/places/aerial-view/lookup-video', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: {} });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'aerial_view_lookup_video',
      videoId: 'vid_9f8a7b6c2d3e',
    });
    expect(getSpy).toHaveBeenCalledWith(
      config,
      '/api/places/aerial-view/lookup-video',
      expect.objectContaining({ videoId: 'vid_9f8a7b6c2d3e' }),
      { paymentPayload: undefined },
    );
  });

  it('rejects aerial_view_render_video without address', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'aerial_view_render_video',
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('dispatches aerial_view_render_video to POST /api/places/aerial-view/render-video', async () => {
    postSpy.mockResolvedValue({ status: 'ok', result: { videoId: 'vid_1' } });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'aerial_view_render_video',
      address: '1600 Amphitheatre Parkway',
    });
    expect(postSpy).toHaveBeenCalledWith(
      config,
      '/api/places/aerial-view/render-video',
      { address: '1600 Amphitheatre Parkway' },
      { paymentPayload: undefined },
    );
  });

  it('records the paid call when a paymentPayload is supplied', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: {} });
    const paymentPayload = { x402Version: 2, accepted: {}, payload: {} };
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'solar_building_insights',
      latitude: 37.4,
      longitude: -122.1,
      paymentPayload,
    });
    expect(walletTracking.recordPaidCall).toHaveBeenCalledWith({
      toolName: 'places.lookup',
      paymentPayload,
    });
  });

  it('surfaces a paymentRequired challenge as a non-error result', async () => {
    getSpy.mockResolvedValue({
      status: 'paymentRequired',
      paymentRequired: { x402Version: 2 },
    });
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'solar_building_insights',
        latitude: 37.4,
        longitude: -122.1,
      },
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      paymentRequired: { x402Version: 2 },
    });
  });
});
