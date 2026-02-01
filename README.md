# acme-love-cloudflare

Cloudflare DNS-01 challenge solver for [acme-love](https://www.npmjs.com/package/acme-love) — automate Let's Encrypt certificates with Cloudflare DNS.

## Installation

```bash
npm install acme-love acme-love-cloudflare
```

## Usage

```typescript
import { AcmeClient, AcmeAccount, provider, generateKeyPair, createAcmeCsr } from 'acme-love';
import { createCloudflareDns01Solver } from 'acme-love-cloudflare';

const client = new AcmeClient(provider.letsencrypt.production);

const algo = { kind: 'ec', namedCurve: 'P-256', hash: 'SHA-256' } as const;
const accountKeys = await generateKeyPair(algo);
const account = new AcmeAccount(client, accountKeys);
await account.register({ contact: 'admin@example.com', termsOfServiceAgreed: true });

const order = await account.createOrder(['example.com', '*.example.com']);

// Create Cloudflare DNS-01 solver
const solver = createCloudflareDns01Solver({
  apiToken: process.env.CF_API_TOKEN!,
});

// Solve challenges automatically
const ready = await account.solveDns01(order, solver);

// Finalize and download certificate
const { derBase64Url } = await createAcmeCsr(['example.com', '*.example.com'], algo);
const finalized = await account.finalize(ready, derBase64Url);
const valid = await account.waitOrder(finalized, ['valid']);
const cert = await account.downloadCertificate(valid);
```

## Configuration

```typescript
const solver = createCloudflareDns01Solver({
  // Required: Cloudflare API token with Zone.DNS edit permissions
  apiToken: process.env.CF_API_TOKEN!,

  // Optional: zone ID (auto-detected if omitted)
  zoneId: 'your-zone-id',

  // Optional: DNS propagation check interval (default: 5000ms)
  propagationInterval: 5_000,

  // Optional: max propagation wait time (default: 120000ms)
  propagationTimeout: 120_000,
});
```

## Cleanup

After certificate issuance, remove the TXT records:

```typescript
await solver.cleanup(preparation);
```

## Requirements

- Node.js >= 22
- acme-love >= 2.0.0
- Cloudflare API token with `Zone.DNS` edit permissions

## License

MIT
