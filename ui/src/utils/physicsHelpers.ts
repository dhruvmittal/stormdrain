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
