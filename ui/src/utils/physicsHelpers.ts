export interface PhysicsSettings {
  chargeStrength: number;
  linkDistance: number;
  collisionRadius: number;
  moduleGravity: number;
  memoryChargeStrength?: number;
  interModuleTensionRatio?: number;
  attenuateInterModule?: boolean;
}

export function getDegreeAwareLinkDistance(attachmentCount: number, baseDistance: number = 30): number {
  if (!attachmentCount || attachmentCount <= 0) return 45;
  return Math.max(45, Math.round(baseDistance + 7 * Math.sqrt(attachmentCount)));
}

export function getEdgeStrength(
  isCodeToCode: boolean,
  isInterModule: boolean,
  baseStrength: number = 0.20,
  interModuleRatio: number = 0.25,
  attenuateEnabled: boolean = true
): number {
  if (isCodeToCode) {
    if (isInterModule && attenuateEnabled) {
      const clampedRatio = Math.max(0.01, Math.min(1.0, interModuleRatio));
      return baseStrength * clampedRatio;
    }
    return baseStrength;
  }
  return 0.85;
}

export function getRepulsionDistanceMax(linkDistance: number, customMax?: number): number {
  if (customMax && customMax > 0) return customMax;
  return Math.max(200, Math.round(1.5 * linkDistance));
}

export function getCollisionRadius(
  nodeType: string,
  isSuperseded: boolean,
  baseCollisionRadius: number = 36
): number {
  if (isSuperseded) return 4;
  if (nodeType === 'codemap') return baseCollisionRadius;
  return 16;
}

export function getMemoryChargeStrength(customMemoryCharge?: number): number {
  return customMemoryCharge ?? -140;
}

export function getAdaptiveAlphaDecay(nodeCount: number): number {
  if (nodeCount < 350) return 0.045;
  if (nodeCount < 1000) return 0.065;
  return 0.085;
}

export function getAdaptiveVelocityDecay(nodeCount: number): number {
  if (nodeCount < 350) return 0.45;
  if (nodeCount < 1000) return 0.55;
  return 0.65;
}

export interface ViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function computeViewportBounds(
  transform: { x: number; y: number; k: number } | null,
  width: number,
  height: number,
  margin: number = 150
): ViewportBounds {
  if (!transform || transform.k === 0) {
    return { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
  }
  const minX = -transform.x / transform.k - margin;
  const minY = -transform.y / transform.k - margin;
  const maxX = (width - transform.x) / transform.k + margin;
  const maxY = (height - transform.y) / transform.k + margin;
  return { minX, minY, maxX, maxY };
}

export function isNodeInViewport(node: { x?: number; y?: number }, bounds: ViewportBounds): boolean {
  if (node.x == null || node.y == null) return false;
  return node.x >= bounds.minX && node.x <= bounds.maxX && node.y >= bounds.minY && node.y <= bounds.maxY;
}

export interface LinkRenderBucket {
  key: string;
  stroke: string;
  lineWidth: number;
  alpha: number;
  isDashed: boolean;
  links: Array<{ s: any; t: any }>;
}

export function groupLinksByRenderStyle(
  links: any[],
  nodeMap: Map<string, any>,
  hoveredId: string | null,
  isFiltering: boolean,
  activeInScopeSet: Set<string>,
  consolidatedNodeIds: Set<string>,
  getEdgeColor: (type: string) => string
): LinkRenderBucket[] {
  const buckets = new Map<string, LinkRenderBucket>();

  for (const l of links) {
    const s = typeof l.source === 'object' ? l.source : nodeMap.get(l.source);
    const t = typeof l.target === 'object' ? l.target : nodeMap.get(l.target);
    if (!s || !t || s.x == null || t.x == null) continue;

    const srcId = s.id;
    const tgtId = t.id;
    const isConnectedToHover = hoveredId && (srcId === hoveredId || tgtId === hoveredId);
    const isConsolidated = consolidatedNodeIds.has(srcId) || consolidatedNodeIds.has(tgtId);

    let linkAlpha = isConsolidated ? 0.15 : ((s.superseded_by || t.superseded_by) ? 0.15 : 0.4);
    let lineWidth = l.type === 'imports' ? 1.2 : 1.8;

    if (hoveredId) {
      if (isConnectedToHover) {
        linkAlpha = 1.0;
        lineWidth = l.type === 'imports' ? 2.2 : 3.0;
      } else {
        linkAlpha = 0.05;
      }
    } else if (isFiltering) {
      const sMatch = activeInScopeSet.has(srcId);
      const tMatch = activeInScopeSet.has(tgtId);
      linkAlpha = (sMatch && tMatch) ? 0.65 : 0.03;
    }

    const strokeColor = getEdgeColor(l.type);
    const isDashed = isConsolidated || l.type === 'imports';
    const key = `${strokeColor}_${lineWidth}_${linkAlpha}_${isDashed}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        stroke: strokeColor,
        lineWidth,
        alpha: linkAlpha,
        isDashed,
        links: []
      };
      buckets.set(key, bucket);
    }
    bucket.links.push({ s, t });
  }

  return Array.from(buckets.values());
}
