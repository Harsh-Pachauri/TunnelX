#!/usr/bin/env node
import { Command } from 'commander';
import { startTunnel } from './connection/tunnel.js';

const program = new Command();

program
  .name('tunnelx')
  .description('TunnelX CLI — expose a local port through the TunnelX gateway')
  .version('0.1.0');

program
  .command('http')
  .description('Start an HTTP tunnel to a local port')
  .argument('<port>', 'local port to expose', (value) => {
    const port = Number.parseInt(value, 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${value}`);
    }
    return port;
  })
  .option('-g, --gateway <url>', 'gateway WebSocket URL', 'ws://localhost:4000/ws/tunnel')
  .option('-k, --api-key <key>', 'API key (not yet validated by the gateway)', 'dev-key')
  .option('-s, --subdomain <name>', 'request a specific subdomain')
  .action((port: number, options: { gateway: string; apiKey: string; subdomain?: string }) => {
    startTunnel({
      localPort: port,
      gatewayUrl: options.gateway,
      apiKey: options.apiKey,
      requestedSubdomain: options.subdomain ?? null,
    });
  });

program.parse();
