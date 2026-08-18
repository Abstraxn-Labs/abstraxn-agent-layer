import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WalletTrackingService } from './services/wallet-tracking.service';
import { registerBlocknumberTool } from './tools/network-blocknumber.tool';
import { registerTransactionStatusTool } from './tools/network-transaction-status.tool';
import { registerGasInfoTool } from './tools/network-gas-info.tool';
import { registerTokenInfoTool } from './tools/network-token-info.tool';
import { registerTokenPriceTool } from './tools/network-token-price.tool';
import { registerMarketCryptoTool } from './tools/market-crypto.tool';
import { registerWeb3LookupTool } from './tools/web3-lookup.tool';
import { registerTravelSearchTool } from './tools/travel-search.tool';
import { registerPlacesLookupTool } from './tools/places-lookup.tool';
import { registerSocialProfileLookupTool } from './tools/social-profile-lookup.tool';
import { registerPrepareTransferTool } from './tools/network-prepare-transfer.tool';

const SERVER_NAME = 'abstraxn-web3-public-mcp';
const SERVER_VERSION = '1.0.0';
const SERVER_DESCRIPTION =
  'Abstraxn public Web3 MCP server — free read-only chain data (block height, gas, ' +
  'transaction status, ERC-20 token info, spot prices), unsigned transfer-transaction ' +
  'building, plus pay-per-call market data, wallet/token/ENS lookups, travel search, ' +
  'places/solar/aerial-view lookups, and social profile lookups, settled directly from the ' +
  "caller's own wallet via the x402 payment protocol. No API key or account required.";

/**
 * Builds one fresh `McpServer` per HTTP request (stateless mode — see `McpController`). There is
 * no per-session state to preserve across calls on this route, so a new instance per request is
 * correct, not a shortcut.
 */
@Injectable()
export class McpServerFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly walletTrackingService: WalletTrackingService,
  ) {}

  create(): McpServer {
    const server = new McpServer(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} }, instructions: SERVER_DESCRIPTION },
    );

    registerBlocknumberTool(server, this.configService);
    registerTransactionStatusTool(server, this.configService);
    registerGasInfoTool(server, this.configService);
    registerTokenInfoTool(server, this.configService);
    registerTokenPriceTool(server);
    registerPrepareTransferTool(server, this.configService);
    registerMarketCryptoTool(
      server,
      this.configService,
      this.walletTrackingService,
    );
    registerWeb3LookupTool(
      server,
      this.configService,
      this.walletTrackingService,
    );
    registerTravelSearchTool(
      server,
      this.configService,
      this.walletTrackingService,
    );
    registerPlacesLookupTool(
      server,
      this.configService,
      this.walletTrackingService,
    );
    registerSocialProfileLookupTool(
      server,
      this.configService,
      this.walletTrackingService,
    );

    return server;
  }
}
