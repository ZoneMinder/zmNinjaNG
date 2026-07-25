import { getEventImageUrl } from '../../api/events';

// The chain shape is declared here, next to the code that resolves it, so this
// module and lib/assistant do not import the settings store (refs #281).
export type ThumbnailFallbackType = 'alarm' | 'snapshot' | 'objdetect' | 'custom';

export interface ThumbnailFallbackEntry {
  type: ThumbnailFallbackType;
  enabled: boolean;
  customFid?: string;
}

export interface ThumbnailChainOptions {
  token?: string;
  width?: number;
  height?: number;
  apiUrl?: string;
  minStreamingPort?: number;
  monitorId?: string;
}

export function resolveFallbackFids(chain: ThumbnailFallbackEntry[] | undefined): string[] {
  const fids: string[] = [];
  if (!Array.isArray(chain)) return fids;
  for (const entry of chain) {
    if (!entry.enabled) continue;
    if (entry.type === 'custom') {
      const fid = entry.customFid?.trim();
      if (fid) fids.push(fid);
      continue;
    }
    fids.push(entry.type);
  }
  return fids;
}

export function buildThumbnailChain(
  portalUrl: string,
  eventId: string,
  chain: ThumbnailFallbackEntry[] | undefined,
  options: ThumbnailChainOptions = {}
): string[] {
  return resolveFallbackFids(chain).map((fid) =>
    getEventImageUrl(portalUrl, eventId, fid, options)
  );
}
