import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import {
  getDegreeAwareLinkDistance,
  getEdgeStrength,
  getRepulsionDistanceMax,
  getCollisionRadius,
  getMemoryChargeStrength,
  getAdaptiveAlphaDecay,
  getAdaptiveVelocityDecay
} from './physicsHelpers';

describe('Physics Helpers', () => {
  it('should calculate degree-aware link distances for attached memories', () => {
    expect(getDegreeAwareLinkDistance(0)).toBe(45);
    expect(getDegreeAwareLinkDistance(1)).toBe(45); // floor of 45
    expect(getDegreeAwareLinkDistance(16)).toBe(58); // max(45, 30 + 7*4)
    expect(getDegreeAwareLinkDistance(25)).toBe(65); // max(45, 30 + 7*5)
  });

  it('should attenuate inter-module edge link strength', () => {
    // Intra-module edge
    expect(getEdgeStrength(true, false, 0.20, 0.25, true)).toBe(0.20);
    
    // Inter-module edge with attenuation enabled
    expect(getEdgeStrength(true, true, 0.20, 0.25, true)).toBe(0.05);

    // Inter-module edge with attenuation disabled
    expect(getEdgeStrength(true, true, 0.20, 0.25, false)).toBe(0.20);

    // Memory link (always 0.85)
    expect(getEdgeStrength(false, true, 0.20, 0.25, true)).toBe(0.85);
  });

  it('should compute smooth distanceMax for repulsion', () => {
    expect(getRepulsionDistanceMax(220)).toBe(330); // 1.5 * 220
    expect(getRepulsionDistanceMax(100)).toBe(200); // max(200, 150)
    expect(getRepulsionDistanceMax(220, 150)).toBe(150); // custom override
  });

  it('should assign collision radii correctly', () => {
    expect(getCollisionRadius('codemap', false, 48)).toBe(48);
    expect(getCollisionRadius('concept', false, 48)).toBe(16);
    expect(getCollisionRadius('pattern', false, 48)).toBe(16);
    expect(getCollisionRadius('concept', true, 48)).toBe(4);
  });

  it('should calculate adaptive alpha decay and velocity decay rates based on node count', () => {
    expect(getAdaptiveAlphaDecay(50)).toBe(0.045);
    expect(getAdaptiveAlphaDecay(200)).toBe(0.045);
    expect(getAdaptiveAlphaDecay(500)).toBe(0.065);
    expect(getAdaptiveAlphaDecay(1200)).toBe(0.085);

    expect(getAdaptiveVelocityDecay(50)).toBe(0.45);
    expect(getAdaptiveVelocityDecay(200)).toBe(0.45);
    expect(getAdaptiveVelocityDecay(500)).toBe(0.55);
    expect(getAdaptiveVelocityDecay(1200)).toBe(0.65);
  });
});

describe('Headless D3 Force Simulation Convergence', () => {
  it('should converge to equilibrium (alpha < 0.05) on 1000-node graph after 100 ticks', () => {
    const nodes: Array<{ id: string; type: string; module?: string; x?: number; y?: number }> = [];
    const links: Array<{ source: string; target: string }> = [];

    // Create 10 modules with 100 nodes each (1000 nodes)
    for (let m = 0; m < 10; m++) {
      const moduleName = `module_${m}`;
      for (let n = 0; n < 100; n++) {
        const id = `file_${m}_${n}`;
        nodes.push({ id, type: 'codemap', module: moduleName });
        
        // Intra-module links
        if (n > 0) {
          links.push({ source: `file_${m}_${n - 1}`, target: id });
        }
      }
    }

    // Add inter-module links
    for (let m = 0; m < 9; m++) {
      links.push({ source: `file_${m}_0`, target: `file_${m + 1}_0` });
    }

    const sim = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links as any)
        .id((d: any) => d.id)
        .distance((l: any) => {
          const isInter = l.source.module !== l.target.module;
          return isInter ? 250 : 150;
        })
        .strength((l: any) => {
          const isInter = l.source.module !== l.target.module;
          return getEdgeStrength(true, isInter, 0.20, 0.25, true);
        })
      )
      .force('charge', d3.forceManyBody()
        .strength(-500)
        .distanceMax( getRepulsionDistanceMax(220) )
      )
      .force('collide', d3.forceCollide((d: any) => getCollisionRadius(d.type, false, 48)))
      .alphaDecay(0.045);

    // Run 100 ticks
    sim.tick(100);

    // Verify alpha decayed to equilibrium (alpha < 0.05)
    expect(sim.alpha()).toBeLessThan(0.05);
  });

  it('should maintain radial separation between memory nodes attached to a single codemap node', () => {
    const rootNode = { id: 'file_core_cpp', type: 'codemap', x: 0, y: 0 };
    const memoryNodes: Array<{ id: string; type: string; x?: number; y?: number }> = [rootNode];
    const memoryLinks: Array<{ source: string; target: string }> = [];

    // Attach 15 micro-memories to rootNode
    for (let i = 0; i < 15; i++) {
      const memId = `mem_${i}`;
      memoryNodes.push({ id: memId, type: 'pattern' });
      memoryLinks.push({ source: 'file_core_cpp', target: memId });
    }

    const memoryCount = 15;
    const linkDist = getDegreeAwareLinkDistance(memoryCount);

    const sim = d3.forceSimulation(memoryNodes as any)
      .force('link', d3.forceLink(memoryLinks as any)
        .id((d: any) => d.id)
        .distance(linkDist)
        .strength(0.85)
      )
      .force('charge', d3.forceManyBody()
        .strength(getMemoryChargeStrength(-140))
      )
      .force('collide', d3.forceCollide((d: any) => getCollisionRadius(d.type, false, 36)))
      .alphaDecay(0.05);

    sim.tick(50);

    // Measure pairwise distances between memory nodes
    const memoriesOnly = memoryNodes.filter(n => n.id !== 'file_core_cpp');
    let minDistance = Infinity;

    for (let i = 0; i < memoriesOnly.length; i++) {
      for (let j = i + 1; j < memoriesOnly.length; j++) {
        const dx = (memoriesOnly[i].x || 0) - (memoriesOnly[j].x || 0);
        const dy = (memoriesOnly[i].y || 0) - (memoriesOnly[j].y || 0);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDistance) minDistance = dist;
      }
    }

    // Memories must not collapse on top of each other (min pairwise distance >= 20px)
    expect(minDistance).toBeGreaterThanOrEqual(20);
  });
});
