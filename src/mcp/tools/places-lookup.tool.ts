import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { PaymentPayload } from '@x402/core/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  callEnrichmentRelayEndpoint,
  callEnrichmentRelayEndpointJson,
} from '../utils/x402-relay.util';
import { WalletTrackingService } from '../services/wallet-tracking.service';
import {
  finalizeRelayResult,
  toErrorToolResult,
} from '../utils/tool-result.util';
import {
  validateArrayLength,
  validateEnum,
  validateExactlyOneOf,
  validateNotPlaceholder,
  validateNumberInRange,
} from '../utils/tool-validation.util';

const TOOL_NAME = 'places.lookup';

const ACTION_ENUM = [
  'text_search_full',
  'text_search_partial',
  'nearby_search_full',
  'nearby_search_partial',
  'place_details_full',
  'place_details_partial',
  'solar_building_insights',
  'solar_data_layers',
  'solar_rgb_image',
  'aerial_view_lookup_video',
  'aerial_view_render_video',
] as const;
type Action = (typeof ACTION_ENUM)[number];

type Dispatch =
  | { method: 'GET'; path: string; params: Record<string, unknown> }
  | { method: 'POST'; path: string; body: Record<string, unknown> };

const REQUIRED_QUALITY_VALUES = ['LOW', 'MEDIUM', 'HIGH'] as const;
const RANK_PREFERENCE_VALUES = ['POPULARITY', 'DISTANCE'] as const;
const VIEW_VALUES = [
  'DSM_LAYER',
  'IMAGERY_LAYERS',
  'IMAGERY_AND_ANNUAL_FLUX_LAYERS',
  'IMAGERY_AND_ALL_FLUX_LAYERS',
  'FULL_LAYERS',
] as const;
const LAYER_VALUES = [
  'rgb',
  'dsm',
  'annualFlux',
  'monthlyFlux',
  'hourlyShade',
  'mask',
] as const;
const FORMAT_VALUES = ['png', 'jpeg'] as const;
const PRICE_LEVEL_VALUES = [
  'PRICE_LEVEL_FREE',
  'PRICE_LEVEL_INEXPENSIVE',
  'PRICE_LEVEL_MODERATE',
  'PRICE_LEVEL_EXPENSIVE',
  'PRICE_LEVEL_VERY_EXPENSIVE',
] as const;

const DESCRIPTION =
  "Places, solar, and aerial-view lookups, paid per call directly from the caller's own " +
  'wallet via the x402 protocol — no Abstraxn account needed. Pick one `action`:\n\n' +
  '- text_search_full ($0.08): full-detail place text search. Requires `textQuery`. Optional ' +
  '`maxResultCount` (1-5, default 5), `excludeFields` (default ["photos"]), `pageToken`, ' +
  '`locationBias` ({circle:{center:{latitude,longitude},radius}}), `includedType`, ' +
  '`languageCode` (default "en"), `openNow`, `minRating` (0-5), `priceLevels`.\n' +
  '- text_search_partial ($0.02): same as text_search_full but returns fewer fields per place — ' +
  'cheaper for quick lookups. Same parameters.\n' +
  '- nearby_search_full ($0.08): full-detail search for places within a radius. Requires ' +
  '`locationRestriction` ({circle:{center:{latitude,longitude},radius (0-50000)}}) — do NOT ' +
  'send a bare top-level latitude/longitude/radius. Optional `includedTypes`/`excludedTypes` ' +
  '(max 50 each), `maxResultCount` (1-5, default 5), `excludeFields` (default ["photos"]), ' +
  '`languageCode` (default "en"), `rankPreference` (POPULARITY default, or DISTANCE).\n' +
  '- nearby_search_partial ($0.02): same as nearby_search_full, fewer fields, cheaper. Same ' +
  'parameters.\n' +
  '- place_details_full ($0.05): full details for one place. Requires `placeId` — the exact ' +
  'place id returned by an earlier text_search/nearby_search result; do not invent or guess ' +
  'it. Optional `excludeFields` (default ["photos"]), `languageCode` (default "en").\n' +
  '- place_details_partial ($0.02): same as place_details_full, fewer fields, cheaper. Same ' +
  'parameters.\n' +
  '- solar_building_insights ($0.02): rooftop solar potential for one location. Requires ' +
  '`latitude` (-90..90) and `longitude` (-180..180). Optional `requiredQuality` ' +
  '(LOW/MEDIUM/HIGH, default HIGH).\n' +
  '- solar_data_layers ($0.08): raw solar data layers for an area. Requires `latitude`, ' +
  '`longitude`. Optional `radiusMeters` (0.1-175, default 50), `view` (default ' +
  '"FULL_LAYERS"), `requiredQuality` (default HIGH), `pixelSizeMeters` (default 0.25, ' +
  'documented as one of 0.1/0.25/0.5/1.0 but not schema-enforced), `exactQualityRequired` ' +
  '(default false).\n' +
  '- solar_rgb_image ($0.05): renders one of the solar_data_layers assets as a viewable image. ' +
  'Either `id` (the exact asset id already returned by an earlier solar_data_layers call — ' +
  '"Mode A"; do not invent or guess it) OR both `latitude` and `longitude` ("Mode B") is ' +
  'required — provide exactly one mode, not both. Optional `radiusMeters` (0.1-100, default 30, ' +
  'Mode B only), `layer` (default "rgb"), `month` (1-12), `hour` (0-23), `format` (png/jpeg, ' +
  'default png), `scale` (1-2, default 1), `crop` (default false), `quality` (1-100, default ' +
  '85).\n' +
  '- aerial_view_lookup_video ($0.01): check whether a rendered aerial-view video already ' +
  'exists / poll its render status. Exactly one of `address` or `videoId` is required — ' +
  '`videoId` must be the exact value returned by an earlier aerial_view_render_video call; do ' +
  'not invent or guess it.\n' +
  '- aerial_view_render_video ($0.01): kick off rendering a new aerial-view video for an ' +
  'address. Requires `address`. Poll aerial_view_lookup_video with the returned videoId until ' +
  'ready.\n\n' +
  'Pagination: text_search_full/partial and nearby_search_full/partial return ' +
  '`nextPageToken` when more results exist — repeat the ORIGINAL call (same textQuery / ' +
  'locationRestriction / etc.) with `pageToken` set to page further. `pageToken` must be the ' +
  'exact `nextPageToken` value from that earlier response — do not invent or guess it.\n' +
  'excludeFields: colon-separated nested-path syntax trims nested response fields, e.g. ' +
  '"organization:technologies" excludes just that sub-field. All place-search/details actions ' +
  'default-exclude `photos` if `excludeFields` is omitted — pass `excludeFields: []` to include ' +
  'photos.\n\n' +
  'Prices above are indicative — the exact charge for a given call is always whatever the ' +
  'live payment challenge specifies for that request. The first call (no `paymentPayload`) ' +
  'returns `paymentRequired`; retry with the same arguments plus `paymentPayload` to complete ' +
  'payment and get the real result.';

export function registerPlacesLookupTool(
  server: McpServer,
  configService: ConfigService,
  walletTrackingService: WalletTrackingService,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Places / solar / aerial-view lookups (pay-per-call)',
      description: DESCRIPTION,
      inputSchema: {
        action: z
          .enum(ACTION_ENUM)
          .describe('Which places/solar/aerial-view operation to perform.'),
        textQuery: z
          .string()
          .optional()
          .describe(
            'text_search_full / text_search_partial: free-text query, e.g. "coffee shops in Brooklyn".',
          ),
        locationBias: z
          .object({
            circle: z.object({
              center: z.object({
                latitude: z.number(),
                longitude: z.number(),
              }),
              radius: z.number().optional(),
            }),
          })
          .optional()
          .describe(
            'text_search_full / text_search_partial: soft location bias. Optional.',
          ),
        includedType: z
          .string()
          .optional()
          .describe(
            'text_search_full / text_search_partial: restrict to one place type, e.g. "restaurant". Optional.',
          ),
        openNow: z
          .boolean()
          .optional()
          .describe(
            'text_search_full / text_search_partial: only return places currently open. Optional.',
          ),
        minRating: z
          .number()
          .min(0)
          .max(5)
          .optional()
          .describe(
            'text_search_full / text_search_partial: minimum average rating filter (0-5). Optional.',
          ),
        priceLevels: z
          .array(z.enum(PRICE_LEVEL_VALUES))
          .optional()
          .describe(
            'text_search_full / text_search_partial: filter by one or more price levels. Optional.',
          ),
        locationRestriction: z
          .object({
            circle: z.object({
              center: z.object({
                latitude: z.number(),
                longitude: z.number(),
              }),
              radius: z.number().min(0).max(50000),
            }),
          })
          .optional()
          .describe(
            'nearby_search_full / nearby_search_partial: REQUIRED hard boundary — ' +
              '{circle:{center:{latitude,longitude}, radius (0-50000)}}.',
          ),
        includedTypes: z
          .array(z.string())
          .max(50)
          .optional()
          .describe(
            'nearby_search_full / nearby_search_partial: place types to include. Optional.',
          ),
        excludedTypes: z
          .array(z.string())
          .max(50)
          .optional()
          .describe(
            'nearby_search_full / nearby_search_partial: place types to exclude. Optional.',
          ),
        rankPreference: z
          .enum(RANK_PREFERENCE_VALUES)
          .optional()
          .describe(
            'nearby_search_full / nearby_search_partial: result ranking, default POPULARITY. Optional.',
          ),
        maxResultCount: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe(
            'text/nearby search: max results per page (1-5, default 5). Optional.',
          ),
        excludeFields: z
          .union([z.array(z.string()), z.string()])
          .optional()
          .describe(
            'Nested-path field names to exclude from the response (colon-separated for ' +
              'nested paths, e.g. "organization:technologies"). Defaults to ["photos"] on ' +
              'every place-search/details action if omitted — pass [] to include photos. Optional.',
          ),
        pageToken: z
          .string()
          .optional()
          .describe(
            'text/nearby search: pagination token from a previous nextPageToken. Optional.',
          ),
        languageCode: z
          .string()
          .optional()
          .describe(
            'text/nearby search, place details: response language, default "en". Optional.',
          ),
        placeId: z
          .string()
          .optional()
          .describe(
            'place_details_full / place_details_partial: REQUIRED place id.',
          ),
        latitude: z
          .number()
          .min(-90)
          .max(90)
          .optional()
          .describe(
            'solar_building_insights / solar_data_layers / solar_rgb_image (Mode B): latitude.',
          ),
        longitude: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe(
            'solar_building_insights / solar_data_layers / solar_rgb_image (Mode B): longitude.',
          ),
        requiredQuality: z
          .enum(REQUIRED_QUALITY_VALUES)
          .optional()
          .describe(
            'solar_building_insights / solar_data_layers: minimum imagery quality, default HIGH. Optional.',
          ),
        view: z
          .enum(VIEW_VALUES)
          .optional()
          .describe(
            'solar_data_layers: which layer set to return, default FULL_LAYERS. Optional.',
          ),
        pixelSizeMeters: z
          .number()
          .optional()
          .describe(
            'solar_data_layers: pixel resolution in meters, default 0.25. One of ' +
              '0.1/0.25/0.5/1.0 by convention but not schema-enforced. Optional.',
          ),
        exactQualityRequired: z
          .boolean()
          .optional()
          .describe(
            'solar_data_layers: fail instead of falling back to lower quality, default false. Optional.',
          ),
        radiusMeters: z
          .number()
          .optional()
          .describe(
            'solar_data_layers: radius in meters (0.1-175, default 50). solar_rgb_image ' +
              '(Mode B only): radius in meters (0.1-100, default 30). Optional.',
          ),
        id: z
          .string()
          .optional()
          .describe(
            'solar_rgb_image (Mode A): asset id from a prior solar_data_layers call.',
          ),
        layer: z
          .enum(LAYER_VALUES)
          .optional()
          .describe(
            'solar_rgb_image: which layer to render, default "rgb". Optional.',
          ),
        month: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe(
            'solar_rgb_image: month for monthlyFlux/hourlyShade layers. Optional.',
          ),
        hour: z
          .number()
          .int()
          .min(0)
          .max(23)
          .optional()
          .describe('solar_rgb_image: hour for hourlyShade layer. Optional.'),
        format: z
          .enum(FORMAT_VALUES)
          .optional()
          .describe(
            'solar_rgb_image: output image format, default png. Optional.',
          ),
        scale: z
          .number()
          .int()
          .min(1)
          .max(2)
          .optional()
          .describe(
            'solar_rgb_image: image scale factor, default 1. Optional.',
          ),
        crop: z
          .boolean()
          .optional()
          .describe(
            'solar_rgb_image: crop to a circle, default false. Optional.',
          ),
        quality: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe(
            'solar_rgb_image: JPEG quality (1-100), default 85. Optional.',
          ),
        address: z
          .string()
          .optional()
          .describe(
            'aerial_view_render_video: REQUIRED address to render. aerial_view_lookup_video: ' +
              'exactly one of address/videoId is required.',
          ),
        videoId: z
          .string()
          .optional()
          .describe(
            'aerial_view_lookup_video: exactly one of address/videoId is required.',
          ),
        paymentPayload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'x402 payment payload from a previous `paymentRequired` challenge. Omit on the first call.',
          ),
      },
      outputSchema: {
        paymentRequired: z.record(z.string(), z.unknown()).optional(),
        error: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: {
        title: 'Places / solar / aerial-view lookups (pay-per-call)',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      return execute(configService, walletTrackingService, args);
    },
  );
}

export async function execute(
  configService: ConfigService,
  walletTrackingService: WalletTrackingService,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const action = args.action as Action;
  const paymentPayload = args.paymentPayload as PaymentPayload | undefined;
  const options = { paymentPayload };
  const context = ` for action=${action}`;

  let dispatch: Dispatch;
  switch (action) {
    case 'text_search_full':
    case 'text_search_partial': {
      const textQuery =
        typeof args.textQuery === 'string' ? args.textQuery.trim() : '';
      if (!textQuery) {
        return toErrorToolResult({ error: `textQuery is required${context}.` });
      }
      const minRatingErr = validateNumberInRange(
        args.minRating,
        'minRating',
        0,
        5,
        context,
      );
      if (minRatingErr) return minRatingErr;
      const maxResultCountErr = validateNumberInRange(
        args.maxResultCount,
        'maxResultCount',
        1,
        5,
        context,
      );
      if (maxResultCountErr) return maxResultCountErr;
      if (Array.isArray(args.priceLevels)) {
        for (const level of args.priceLevels) {
          const levelErr = validateEnum(
            level,
            'priceLevels',
            PRICE_LEVEL_VALUES,
            context,
          );
          if (levelErr) return levelErr;
        }
      }
      if (typeof args.pageToken === 'string' && args.pageToken.trim()) {
        const pageTokenErr = validateNotPlaceholder(
          args.pageToken.trim(),
          'pageToken',
          context,
        );
        if (pageTokenErr) return pageTokenErr;
      }
      dispatch = {
        method: 'POST',
        path:
          action === 'text_search_full'
            ? '/api/places/text-search/full'
            : '/api/places/text-search/partial',
        body: {
          textQuery,
          maxResultCount: args.maxResultCount,
          excludeFields: args.excludeFields,
          pageToken: args.pageToken,
          locationBias: args.locationBias,
          includedType: args.includedType,
          languageCode: args.languageCode,
          openNow: args.openNow,
          minRating: args.minRating,
          priceLevels: args.priceLevels,
        },
      };
      break;
    }
    case 'nearby_search_full':
    case 'nearby_search_partial': {
      const restriction = args.locationRestriction;
      const circle =
        restriction &&
        typeof restriction === 'object' &&
        !Array.isArray(restriction)
          ? (restriction as Record<string, unknown>).circle
          : undefined;
      const center =
        circle && typeof circle === 'object' && !Array.isArray(circle)
          ? (circle as Record<string, unknown>).center
          : undefined;
      const centerLat =
        center && typeof center === 'object' && !Array.isArray(center)
          ? (center as Record<string, unknown>).latitude
          : undefined;
      const centerLng =
        center && typeof center === 'object' && !Array.isArray(center)
          ? (center as Record<string, unknown>).longitude
          : undefined;
      const radius =
        circle && typeof circle === 'object' && !Array.isArray(circle)
          ? (circle as Record<string, unknown>).radius
          : undefined;
      const hasCenter =
        typeof centerLat === 'number' && typeof centerLng === 'number';
      if (!hasCenter) {
        return toErrorToolResult({
          error:
            'locationRestriction ({circle:{center:{latitude,longitude}, radius}}) is ' +
            `required${context}.`,
        });
      }
      const latErr = validateNumberInRange(
        centerLat,
        'locationRestriction.circle.center.latitude',
        -90,
        90,
        context,
      );
      if (latErr) return latErr;
      const lngErr = validateNumberInRange(
        centerLng,
        'locationRestriction.circle.center.longitude',
        -180,
        180,
        context,
      );
      if (lngErr) return lngErr;
      const radiusErr = validateNumberInRange(
        radius,
        'locationRestriction.circle.radius',
        0,
        50000,
        context,
      );
      if (radiusErr) return radiusErr;
      const includedTypesErr = validateArrayLength(
        args.includedTypes,
        'includedTypes',
        50,
        context,
      );
      if (includedTypesErr) return includedTypesErr;
      const excludedTypesErr = validateArrayLength(
        args.excludedTypes,
        'excludedTypes',
        50,
        context,
      );
      if (excludedTypesErr) return excludedTypesErr;
      const maxResultCountErr = validateNumberInRange(
        args.maxResultCount,
        'maxResultCount',
        1,
        5,
        context,
      );
      if (maxResultCountErr) return maxResultCountErr;
      const rankPreferenceErr = validateEnum(
        args.rankPreference,
        'rankPreference',
        RANK_PREFERENCE_VALUES,
        context,
      );
      if (rankPreferenceErr) return rankPreferenceErr;
      dispatch = {
        method: 'POST',
        path:
          action === 'nearby_search_full'
            ? '/api/places/nearby-search/full'
            : '/api/places/nearby-search/partial',
        body: {
          locationRestriction: restriction,
          includedTypes: args.includedTypes,
          excludedTypes: args.excludedTypes,
          maxResultCount: args.maxResultCount,
          excludeFields: args.excludeFields,
          languageCode: args.languageCode,
          rankPreference: args.rankPreference,
        },
      };
      break;
    }
    case 'place_details_full':
    case 'place_details_partial': {
      const placeId =
        typeof args.placeId === 'string' ? args.placeId.trim() : '';
      if (!placeId) {
        return toErrorToolResult({ error: `placeId is required${context}.` });
      }
      const placeIdErr = validateNotPlaceholder(placeId, 'placeId', context);
      if (placeIdErr) return placeIdErr;
      dispatch = {
        method: 'GET',
        path:
          action === 'place_details_full'
            ? '/api/places/place-details/full'
            : '/api/places/place-details/partial',
        params: {
          placeId,
          excludeFields: args.excludeFields,
          languageCode: args.languageCode,
        },
      };
      break;
    }
    case 'solar_building_insights': {
      const latitude =
        typeof args.latitude === 'number' ? args.latitude : undefined;
      const longitude =
        typeof args.longitude === 'number' ? args.longitude : undefined;
      if (latitude === undefined || longitude === undefined) {
        return toErrorToolResult({
          error: `latitude and longitude are required${context}.`,
        });
      }
      const latErr = validateNumberInRange(
        latitude,
        'latitude',
        -90,
        90,
        context,
      );
      if (latErr) return latErr;
      const lngErr = validateNumberInRange(
        longitude,
        'longitude',
        -180,
        180,
        context,
      );
      if (lngErr) return lngErr;
      const qualityErr = validateEnum(
        args.requiredQuality,
        'requiredQuality',
        REQUIRED_QUALITY_VALUES,
        context,
      );
      if (qualityErr) return qualityErr;
      dispatch = {
        method: 'GET',
        path: '/api/places/solar/building-insights',
        params: { latitude, longitude, requiredQuality: args.requiredQuality },
      };
      break;
    }
    case 'solar_data_layers': {
      const latitude =
        typeof args.latitude === 'number' ? args.latitude : undefined;
      const longitude =
        typeof args.longitude === 'number' ? args.longitude : undefined;
      if (latitude === undefined || longitude === undefined) {
        return toErrorToolResult({
          error: `latitude and longitude are required${context}.`,
        });
      }
      const latErr = validateNumberInRange(
        latitude,
        'latitude',
        -90,
        90,
        context,
      );
      if (latErr) return latErr;
      const lngErr = validateNumberInRange(
        longitude,
        'longitude',
        -180,
        180,
        context,
      );
      if (lngErr) return lngErr;
      const radiusErr = validateNumberInRange(
        args.radiusMeters,
        'radiusMeters',
        0.1,
        175,
        context,
      );
      if (radiusErr) return radiusErr;
      const viewErr = validateEnum(args.view, 'view', VIEW_VALUES, context);
      if (viewErr) return viewErr;
      const qualityErr = validateEnum(
        args.requiredQuality,
        'requiredQuality',
        REQUIRED_QUALITY_VALUES,
        context,
      );
      if (qualityErr) return qualityErr;
      dispatch = {
        method: 'GET',
        path: '/api/places/solar/data-layers',
        params: {
          latitude,
          longitude,
          radiusMeters: args.radiusMeters,
          view: args.view,
          requiredQuality: args.requiredQuality,
          pixelSizeMeters: args.pixelSizeMeters,
          exactQualityRequired: args.exactQualityRequired,
        },
      };
      break;
    }
    case 'solar_rgb_image': {
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      const latitude =
        typeof args.latitude === 'number' ? args.latitude : undefined;
      const longitude =
        typeof args.longitude === 'number' ? args.longitude : undefined;
      const anyCoord =
        args.latitude !== undefined || args.longitude !== undefined;
      if (id && anyCoord) {
        return toErrorToolResult({
          error: `Provide either id (Mode A) or latitude+longitude (Mode B)${context}, not both.`,
        });
      }
      const hasCoords = latitude !== undefined && longitude !== undefined;
      if (!id && !hasCoords) {
        return toErrorToolResult({
          error: `Either id or both latitude and longitude are required${context}.`,
        });
      }
      if (id) {
        const idErr = validateNotPlaceholder(id, 'id', context);
        if (idErr) return idErr;
      }
      if (hasCoords) {
        const latErr = validateNumberInRange(
          latitude,
          'latitude',
          -90,
          90,
          context,
        );
        if (latErr) return latErr;
        const lngErr = validateNumberInRange(
          longitude,
          'longitude',
          -180,
          180,
          context,
        );
        if (lngErr) return lngErr;
      }
      const radiusErr = validateNumberInRange(
        args.radiusMeters,
        'radiusMeters',
        0.1,
        100,
        context,
      );
      if (radiusErr) return radiusErr;
      const layerErr = validateEnum(args.layer, 'layer', LAYER_VALUES, context);
      if (layerErr) return layerErr;
      const monthErr = validateNumberInRange(
        args.month,
        'month',
        1,
        12,
        context,
      );
      if (monthErr) return monthErr;
      const hourErr = validateNumberInRange(args.hour, 'hour', 0, 23, context);
      if (hourErr) return hourErr;
      const formatErr = validateEnum(
        args.format,
        'format',
        FORMAT_VALUES,
        context,
      );
      if (formatErr) return formatErr;
      const scaleErr = validateNumberInRange(
        args.scale,
        'scale',
        1,
        2,
        context,
      );
      if (scaleErr) return scaleErr;
      const qualityErr = validateNumberInRange(
        args.quality,
        'quality',
        1,
        100,
        context,
      );
      if (qualityErr) return qualityErr;
      dispatch = {
        method: 'GET',
        path: '/api/places/solar/rgb-image',
        params: {
          id: id || undefined,
          latitude,
          longitude,
          radiusMeters: args.radiusMeters,
          layer: args.layer,
          month: args.month,
          hour: args.hour,
          format: args.format,
          scale: args.scale,
          crop: args.crop,
          quality: args.quality,
        },
      };
      break;
    }
    case 'aerial_view_lookup_video': {
      const address =
        typeof args.address === 'string' ? args.address.trim() : '';
      const videoId =
        typeof args.videoId === 'string' ? args.videoId.trim() : '';
      const modeErr = validateExactlyOneOf(
        [
          { name: 'address', present: Boolean(address) },
          { name: 'videoId', present: Boolean(videoId) },
        ],
        context,
      );
      if (modeErr) return modeErr;
      if (videoId) {
        const videoIdErr = validateNotPlaceholder(videoId, 'videoId', context);
        if (videoIdErr) return videoIdErr;
      }
      dispatch = {
        method: 'GET',
        path: '/api/places/aerial-view/lookup-video',
        params: {
          address: address || undefined,
          videoId: videoId || undefined,
        },
      };
      break;
    }
    case 'aerial_view_render_video': {
      const address =
        typeof args.address === 'string' ? args.address.trim() : '';
      if (!address) {
        return toErrorToolResult({ error: `address is required${context}.` });
      }
      dispatch = {
        method: 'POST',
        path: '/api/places/aerial-view/render-video',
        body: { address },
      };
      break;
    }
  }

  const result =
    dispatch.method === 'GET'
      ? await callEnrichmentRelayEndpoint(
          configService,
          dispatch.path,
          dispatch.params,
          options,
        )
      : await callEnrichmentRelayEndpointJson(
          configService,
          dispatch.path,
          dispatch.body,
          options,
        );

  return finalizeRelayResult(
    result,
    TOOL_NAME,
    paymentPayload,
    walletTrackingService,
  );
}
