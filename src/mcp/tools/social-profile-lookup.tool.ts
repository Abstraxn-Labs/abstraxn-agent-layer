import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { PaymentPayload } from '@x402/core/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { callEnrichmentRelayEndpointJson } from '../utils/x402-relay.util';
import { WalletTrackingService } from '../services/wallet-tracking.service';
import {
  finalizeRelayResult,
  toErrorToolResult,
} from '../utils/tool-result.util';

const TOOL_NAME = 'social.profile_lookup';

const DESCRIPTION =
  'Resolve person / social-profile identity for a batch of records, paid per call directly ' +
  "from the caller's own wallet via the x402 protocol — no Abstraxn account needed. Supports " +
  'two modes per record:\n\n' +
  '- Fuzzy match: supply `first_name` and/or `last_name` plus `emails` and/or `phones`.\n' +
  '- Reverse lookup: supply only `emails` and/or `phones`, no name required.\n\n' +
  'Every record needs a caller-chosen `record_id` (any string) to correlate it with its match ' +
  'in the response, plus at least one non-empty first_name/last_name, or at least one ' +
  'non-empty entry in emails, or at least one non-empty entry in phones — an empty array ' +
  'counts as not provided. Optional top-level `match_condition_fields` (e.g. ' +
  '`["linkedin_url"]`) restricts results to matches that include ALL of the named fields.\n\n' +
  'The exact response shape (field names/nesting per match) is passed through unchanged from ' +
  'the upstream provider — read whatever comes back rather than assuming a fixed shape.\n\n' +
  'Charges ~$0.02 per call — the exact charge for a given call is always whatever the live ' +
  'payment challenge specifies for that request. The first call (no `paymentPayload`) returns ' +
  '`paymentRequired`; retry with the same arguments plus `paymentPayload` to complete payment ' +
  'and get the real result.';

export function registerSocialProfileLookupTool(
  server: McpServer,
  configService: ConfigService,
  walletTrackingService: WalletTrackingService,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Social / person profile lookup (pay-per-call)',
      description: DESCRIPTION,
      inputSchema: {
        records: z
          .array(
            z.object({
              record_id: z
                .string()
                .describe(
                  'Caller-chosen id to correlate this record with its match in the response.',
                ),
              first_name: z.string().optional(),
              last_name: z.string().optional(),
              emails: z.array(z.string()).optional(),
              phones: z.array(z.string()).optional(),
            }),
          )
          .min(1)
          .describe(
            'Records to resolve. Each needs record_id plus at least one non-empty ' +
              'first_name/last_name, emails entry, or phones entry.',
          ),
        match_condition_fields: z
          .array(z.string())
          .optional()
          .describe(
            'Optional filter — only return matches whose result includes ALL of these ' +
              'fields, e.g. ["linkedin_url"].',
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
        title: 'Social / person profile lookup (pay-per-call)',
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
  const paymentPayload = args.paymentPayload as PaymentPayload | undefined;
  const options = { paymentPayload };

  const records = args.records;
  if (!Array.isArray(records) || records.length === 0) {
    return toErrorToolResult({
      error: 'records (a non-empty array of {record_id, ...}) is required.',
    });
  }

  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return toErrorToolResult({
        error: 'Each entry in records must be an object.',
      });
    }
    const r = record as Record<string, unknown>;
    const recordId = typeof r.record_id === 'string' ? r.record_id.trim() : '';
    if (!recordId) {
      return toErrorToolResult({
        error: 'Each record requires a non-empty record_id.',
      });
    }
    const hasName =
      (typeof r.first_name === 'string' && r.first_name.trim().length > 0) ||
      (typeof r.last_name === 'string' && r.last_name.trim().length > 0);
    const hasEmails =
      Array.isArray(r.emails) &&
      r.emails.some((e) => typeof e === 'string' && e.trim().length > 0);
    const hasPhones =
      Array.isArray(r.phones) &&
      r.phones.some((p) => typeof p === 'string' && p.trim().length > 0);
    if (!hasName && !hasEmails && !hasPhones) {
      return toErrorToolResult({
        error: `record "${recordId}" needs at least one of first_name/last_name, emails, or phones.`,
      });
    }
  }

  const result = await callEnrichmentRelayEndpointJson(
    configService,
    '/api/social/profile-lookup',
    { records, match_condition_fields: args.match_condition_fields },
    options,
  );

  return finalizeRelayResult(
    result,
    TOOL_NAME,
    paymentPayload,
    walletTrackingService,
  );
}
