import type { ChallengePreparation } from "acme-love";

const CF_API = "https://api.cloudflare.com/client/v4";

export interface CloudflareConfig {
  /** Cloudflare API token with DNS edit permissions */
  apiToken: string;
  /** Zone ID for the domain. If omitted, resolved automatically from the domain. */
  zoneId?: string;
  /** Propagation check interval in ms (default: 5000) */
  propagationInterval?: number;
  /** Maximum propagation wait time in ms (default: 120000) */
  propagationTimeout?: number;
}

export interface CloudflareDns01Solver {
  setDns: (preparation: ChallengePreparation) => Promise<void>;
  waitFor: (preparation: ChallengePreparation) => Promise<void>;
  cleanup: (preparation: ChallengePreparation) => Promise<void>;
  /** Remove all TXT records created during this solver's lifetime. */
  cleanupAll: () => Promise<void>;
}

interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

async function cfFetch<T>(
  path: string,
  apiToken: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });

  const json = (await res.json()) as {
    success: boolean;
    result: T;
    errors: Array<{ message: string }>;
  };

  if (!json.success) {
    const msg =
      json.errors?.map((e) => e.message).join(", ") ||
      "Unknown Cloudflare API error";
    throw new Error(`Cloudflare API error: ${msg}`);
  }

  return json.result;
}

async function findZoneId(apiToken: string, domain: string): Promise<string> {
  const parts = domain.replace(/^_acme-challenge\./, "").split(".");

  for (let i = 0; i < parts.length - 1; i++) {
    const zone = parts.slice(i).join(".");
    const zones = await cfFetch<Array<{ id: string; name: string }>>(
      `/zones?name=${encodeURIComponent(zone)}`,
      apiToken,
    );
    if (zones.length > 0) {
      return zones[0].id;
    }
  }

  throw new Error(`Could not find Cloudflare zone for domain: ${domain}`);
}

/**
 * Creates a Cloudflare DNS-01 challenge solver for use with acme-love.
 *
 * @example
 * ```ts
 * import { createCloudflareDns01Solver } from 'acme-love-cloudflare';
 *
 * const solver = createCloudflareDns01Solver({
 *   apiToken: process.env.CF_API_TOKEN!,
 * });
 *
 * const ready = await account.solveDns01(order, solver);
 * await solver.cleanupAll(); // remove all TXT records
 * ```
 */
export function createCloudflareDns01Solver(
  config: CloudflareConfig,
): CloudflareDns01Solver {
  const {
    apiToken,
    propagationInterval = 5_000,
    propagationTimeout = 120_000,
  } = config;
  const recordIds = new Map<string, string>();
  const preparations: ChallengePreparation[] = [];

  async function getZoneId(target: string): Promise<string> {
    if (config.zoneId) return config.zoneId;
    return findZoneId(apiToken, target);
  }

  const setDns = async (preparation: ChallengePreparation): Promise<void> => {
    preparations.push(preparation);
    const zoneId = await getZoneId(preparation.target);

    const record = await cfFetch<CloudflareDnsRecord>(
      `/zones/${zoneId}/dns_records`,
      apiToken,
      {
        method: "POST",
        body: JSON.stringify({
          type: "TXT",
          name: preparation.target,
          content: preparation.value,
          ttl: 120,
        }),
      },
    );

    recordIds.set(preparation.target, record.id);
  };

  const waitFor = async (preparation: ChallengePreparation): Promise<void> => {
    const start = Date.now();

    while (Date.now() - start < propagationTimeout) {
      try {
        const { resolve } = await import("node:dns/promises");
        const records = await resolve(preparation.target, "TXT");
        const flat = records.flat();
        if (flat.includes(preparation.value)) return;
      } catch {
        // DNS not propagated yet
      }
      await new Promise((r) => setTimeout(r, propagationInterval));
    }

    throw new Error(
      `DNS propagation timeout after ${propagationTimeout}ms for ${preparation.target}`,
    );
  };

  const cleanup = async (preparation: ChallengePreparation): Promise<void> => {
    const recordId = recordIds.get(preparation.target);
    if (!recordId) return;

    const zoneId = await getZoneId(preparation.target);

    await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, apiToken, {
      method: "DELETE",
    });

    recordIds.delete(preparation.target);
  };

  const cleanupAll = async (): Promise<void> => {
    for (const p of preparations) {
      await cleanup(p);
    }
    preparations.length = 0;
  };

  return { setDns, waitFor, cleanup, cleanupAll };
}
