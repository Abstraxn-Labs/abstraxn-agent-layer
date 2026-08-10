import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { PaymentPayload } from '@x402/core/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  callUpstreamRelayEndpoint,
  callUpstreamRelayEndpointJson,
} from '../utils/x402-relay.util';
import { WalletTrackingService } from '../services/wallet-tracking.service';
import {
  finalizeRelayResult,
  toErrorToolResult,
} from '../utils/tool-result.util';

const TOOL_NAME = 'web3.lookup';

const ACTION_ENUM = [
  'wallet_balances',
  'wallet_transactions',
  'wallet_pnl',
  'token_metadata',
  'ens_resolve',
  'ens_reverse',
  'tx_simulate',
] as const;
type Action = (typeof ACTION_ENUM)[number];

type Dispatch =
  | { method: 'GET'; path: string; params: Record<string, unknown> }
  | { method: 'POST'; path: string; body: Record<string, unknown> };

const DESCRIPTION =
  'Multi-chain wallet, token, ENS, and transaction-simulation lookups, paid per call in ' +
  "USDC/USDm directly from the caller's own wallet via the x402 protocol — no Abstraxn " +
  'account needed. Pick one `action`:\n\n' +
  '- wallet_balances ($0.005): token balances for a wallet across 20+ chains. Requires ' +
  '`chain` and `address`.\n' +
  '- wallet_transactions ($0.005): transaction history with asset transfers for a wallet. ' +
  'Requires `address`. Optional `chain`, `limit`.\n' +
  '- wallet_pnl ($0.01): realized and unrealized profit/loss per token for a wallet. Requires ' +
  '`chain` and `address`.\n' +
  '- token_metadata ($0.002): name/symbol/decimals for a token contract. Requires `chain` and ' +
  '`address`.\n' +
  '- ens_resolve ($0.001): resolve an ENS name to an Ethereum address. Requires `name`.\n' +
  '- ens_reverse ($0.001): resolve an Ethereum address to its ENS name. Requires `address`.\n' +
  '- tx_simulate ($0.01): simulate an EVM transaction before sending — gas estimate, execution ' +
  'trace, revert reason. Requires `network_id`, `from`, `to`. Optional `value`, `data`, `gas`.\n\n' +
  'Prices above are indicative — the exact charge for a given call is always whatever the ' +
  'live payment challenge specifies for that request. The first call (no `paymentPayload`) ' +
  'returns `paymentRequired`; retry with the same arguments plus `paymentPayload` to complete ' +
  'payment and get the real result.';

export function registerWeb3LookupTool(
  server: McpServer,
  configService: ConfigService,
  walletTrackingService: WalletTrackingService,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Wallet / token / ENS / tx-simulation lookups (pay-per-call)',
      description: DESCRIPTION,
      inputSchema: {
        action: z
          .enum(ACTION_ENUM)
          .describe('Which web3 operation to perform.'),
        chain: z
          .string()
          .optional()
          .describe(
            'wallet_balances / wallet_transactions / wallet_pnl / token_metadata: chain name, e.g. "ethereum", "base", "solana".',
          ),
        address: z
          .string()
          .optional()
          .describe(
            'Address to look up — a wallet address for wallet_balances / wallet_transactions / wallet_pnl / ens_reverse, or a token contract address for token_metadata.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe(
            'wallet_transactions: max transactions to return, default 100.',
          ),
        name: z
          .string()
          .optional()
          .describe('ens_resolve: ENS name to resolve, e.g. "vitalik.eth".'),
        network_id: z
          .string()
          .optional()
          .describe(
            'tx_simulate: EVM chain id as a string, e.g. "1" or "8453".',
          ),
        from: z
          .string()
          .optional()
          .describe(
            'tx_simulate: sender address for the simulated transaction.',
          ),
        to: z
          .string()
          .optional()
          .describe(
            'tx_simulate: recipient/contract address for the simulated transaction.',
          ),
        value: z
          .string()
          .optional()
          .describe(
            'tx_simulate: transaction value in wei, as a string. Optional, default "0".',
          ),
        data: z
          .string()
          .optional()
          .describe('tx_simulate: hex-encoded calldata. Optional.'),
        gas: z
          .number()
          .int()
          .optional()
          .describe('tx_simulate: gas limit override. Optional.'),
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
        title: 'Wallet / token / ENS / tx-simulation lookups (pay-per-call)',
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

  let dispatch: Dispatch;
  switch (action) {
    case 'wallet_balances': {
      const chain = typeof args.chain === 'string' ? args.chain.trim() : '';
      const address =
        typeof args.address === 'string' ? args.address.trim() : '';
      if (!chain || !address) {
        return toErrorToolResult({
          error: 'chain and address are required for action=wallet_balances.',
        });
      }
      dispatch = {
        method: 'POST',
        path: '/api/wallet/balances',
        body: { chain, address },
      };
      break;
    }
    case 'wallet_transactions': {
      const address =
        typeof args.address === 'string' ? args.address.trim() : '';
      if (!address) {
        return toErrorToolResult({
          error: 'address is required for action=wallet_transactions.',
        });
      }
      dispatch = {
        method: 'POST',
        path: '/api/wallet/transactions',
        body: { address, chain: args.chain, limit: args.limit },
      };
      break;
    }
    case 'wallet_pnl': {
      const chain = typeof args.chain === 'string' ? args.chain.trim() : '';
      const address =
        typeof args.address === 'string' ? args.address.trim() : '';
      if (!chain || !address) {
        return toErrorToolResult({
          error: 'chain and address are required for action=wallet_pnl.',
        });
      }
      dispatch = {
        method: 'POST',
        path: '/api/wallet/pnl',
        body: { chain, address },
      };
      break;
    }
    case 'token_metadata': {
      const chain = typeof args.chain === 'string' ? args.chain.trim() : '';
      const address =
        typeof args.address === 'string' ? args.address.trim() : '';
      if (!chain || !address) {
        return toErrorToolResult({
          error: 'chain and address are required for action=token_metadata.',
        });
      }
      dispatch = {
        method: 'GET',
        path: '/api/token/metadata',
        params: { chain, address },
      };
      break;
    }
    case 'ens_resolve': {
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!name) {
        return toErrorToolResult({
          error: 'name is required for action=ens_resolve.',
        });
      }
      dispatch = { method: 'GET', path: '/api/ens/resolve', params: { name } };
      break;
    }
    case 'ens_reverse': {
      const address =
        typeof args.address === 'string' ? args.address.trim() : '';
      if (!address) {
        return toErrorToolResult({
          error: 'address is required for action=ens_reverse.',
        });
      }
      dispatch = {
        method: 'GET',
        path: '/api/ens/reverse',
        params: { address },
      };
      break;
    }
    case 'tx_simulate': {
      const networkId =
        typeof args.network_id === 'string' ? args.network_id.trim() : '';
      const from = typeof args.from === 'string' ? args.from.trim() : '';
      const to = typeof args.to === 'string' ? args.to.trim() : '';
      if (!networkId || !from || !to) {
        return toErrorToolResult({
          error:
            'network_id, from, and to are required for action=tx_simulate.',
        });
      }
      dispatch = {
        method: 'POST',
        path: '/api/tx/simulate',
        body: {
          network_id: networkId,
          from,
          to,
          value: args.value,
          data: args.data,
          gas: args.gas,
        },
      };
      break;
    }
  }

  const result =
    dispatch.method === 'GET'
      ? await callUpstreamRelayEndpoint(
          configService,
          dispatch.path,
          dispatch.params,
          options,
        )
      : await callUpstreamRelayEndpointJson(
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
