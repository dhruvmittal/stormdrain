import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { api, applyThemeColors, type GraphColorSettings } from '../api';
import MemoryEditor from './MemoryEditor';
import { Search, X, Crosshair, Layers, ChevronUp, ChevronDown, SlidersHorizontal, Orbit, Compass, Sparkles } from 'lucide-react';


interface GraphViewProps {
  activeContext: string;
  dataVersion?: number;
}

type ScopeDepth = 0 | 1 | 2;

const MEMORY_TYPES = ['all', 'concept', 'pattern', 'guide', 'lesson', 'fact', 'warning', 'codemap', 'sequence'] as const;

// Physics Engine Types & Presets
interface PhysicsSettings {
  chargeStrength: number;
  linkDistance: number;
  collisionRadius: number;
  moduleGravity: number;
  activePreset: 'auto' | 'compact' | 'standard' | 'dense' | 'massive' | 'custom';
}

const PHYSICS_PRESETS: Record<string, Omit<PhysicsSettings, 'activePreset'>> = {
  compact:  { chargeStrength: -220, linkDistance: 90,  collisionRadius: 28, moduleGravity: 0.10 },
  standard: { chargeStrength: -350, linkDistance: 130, collisionRadius: 36, moduleGravity: 0.15 },
  dense:    { chargeStrength: -600, linkDistance: 170, collisionRadius: 42, moduleGravity: 0.22 },
  massive:  { chargeStrength: -900, linkDistance: 220, collisionRadius: 48, moduleGravity: 0.28 },
};

const DEFAULT_PHYSICS: PhysicsSettings = { ...PHYSICS_PRESETS.standard, activePreset: 'auto' };
const PHYSICS_STORAGE_KEY = 'stormdrain_graph_physics_settings';

function getAutoPreset(nodeCount: number): Omit<PhysicsSettings, 'activePreset'> {
  if (nodeCount < 100) return PHYSICS_PRESETS.compact;
  if (nodeCount < 500) return PHYSICS_PRESETS.standard;
  if (nodeCount < 1000) return PHYSICS_PRESETS.dense;
  return PHYSICS_PRESETS.massive;
}

function getModuleName(node: any): string {
  if (node.type === 'codemap' || node.id?.startsWith('file_')) {
    const path = node.title || '';
    const segments = path.split('/');
    if (segments.length >= 3) return segments.slice(0, 2).join('/');
    if (segments.length >= 2) return segments[0];
    return '_root';
  }
  return '_memories';
}

export const GraphView: React.FC<GraphViewProps> = ({ activeContext, dataVersion = 0 }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // D3 persistent refs
  const simulationRef = useRef<d3.Simulation<any, any> | null>(null);
  const containerRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const nodeSelectionRef = useRef<d3.Selection<SVGGElement, any, SVGGElement, unknown> | null>(null);
  const linkSelectionRef = useRef<d3.Selection<SVGLineElement, any, SVGGElement, unknown> | null>(null);
  const rawGraphDataRef = useRef<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const adjacencyRef = useRef<Map<string, Set<string>>>(new Map());

  // Performance & Position Preservation refs
  const isInitializedRef = useRef<boolean>(false);
  const previousContextRef = useRef<string>(activeContext);
  const positionsCacheRef = useRef<Map<string, { x: number; y: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null }>>(new Map());
  const currentZoomTransformRef = useRef<d3.ZoomTransform | null>(null);
  const activeTier1SetRef = useRef<Set<string>>(new Set());
  const activeInScopeSetRef = useRef<Set<string>>(new Set());

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [scopeDepth, setScopeDepth] = useState<ScopeDepth>(1);
  const [focusAnchorId, setFocusAnchorId] = useState<string | null>(null);
  const [focusAnchorTitle, setFocusAnchorTitle] = useState<string | null>(null);
  
  const [matchStats, setMatchStats] = useState<{
    matchCount: number;
    inScopeCount: number;
    totalCount: number;
    isFiltering: boolean;
    hasNoMatches: boolean;
  }>({
    matchCount: 0,
    inScopeCount: 0,
    totalCount: 0,
    isFiltering: false,
    hasNoMatches: false,
  });

  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState<number>(0);
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('stormdrain_graph_hud_collapsed') === 'true';
  });

  // Layout Mode & Physics Customization State
  const [layoutMode, setLayoutMode] = useState<'force' | 'orbit'>('force');
  const layoutModeRef = useRef<'force' | 'orbit'>(layoutMode);
  useEffect(() => {
    layoutModeRef.current = layoutMode;
  }, [layoutMode]);
  const [isPhysicsOpen, setIsPhysicsOpen] = useState<boolean>(false);
  const [physics, setPhysics] = useState<PhysicsSettings>(() => {
    try {
      const saved = localStorage.getItem(PHYSICS_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {}
    return DEFAULT_PHYSICS;
  });

  const updatePhysics = (updates: Partial<PhysicsSettings>) => {
    setPhysics(prev => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem(PHYSICS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const applyPreset = (presetKey: PhysicsSettings['activePreset']) => {
    if (presetKey === 'auto') {
      const nodeCount = rawGraphDataRef.current.nodes?.length || 0;
      const autoValues = getAutoPreset(nodeCount);
      updatePhysics({ ...autoValues, activePreset: 'auto' });
    } else if (presetKey in PHYSICS_PRESETS) {
      updatePhysics({ ...PHYSICS_PRESETS[presetKey], activePreset: presetKey });
    }
  };

  const toggleToolbarCollapse = () => {
    setIsToolbarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('stormdrain_graph_hud_collapsed', String(next));
      return next;
    });
  };

  const effectiveVersion = dataVersion + localVersion;

  // Debounce search query (150ms for responsive spotlight without layout jitter)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        if (searchQuery || selectedType !== 'all' || focusAnchorId) {
          e.preventDefault();
          setSearchQuery('');
          setDebouncedQuery('');
          setSelectedType('all');
          setFocusAnchorId(null);
          setFocusAnchorTitle(null);
        } else if (!isToolbarCollapsed) {
          setIsToolbarCollapsed(true);
          localStorage.setItem('stormdrain_graph_hud_collapsed', 'true');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, selectedType, focusAnchorId, isToolbarCollapsed]);

  const [colorSettings, setColorSettings] = useState<GraphColorSettings>({
    nodes: {
      concept: '#38bdf8',
      codemap: '#06b6d4',
      fact: '#10b981',
      lesson: '#f59e0b',
      pattern: '#8b5cf6',
      warning: '#ef4444',
      guide: '#ec4899',
      sequence: '#6366f1'
    },
    edges: {
      affects: '#38bdf8',
      applies_to: '#0ea5e9',
      supports: '#10b981',
      contradicts: '#ef4444',
      supersedes: '#f59e0b',
      related_to: '#94a3b8',
      references: '#a855f7',
      depends_on: '#6366f1',
      part_of: '#ec4899',
      distilled_from: '#8b5cf6',
      imports: '#38bdf8',
      defaultEdge: '#334155'
    }
  });

  useEffect(() => {
    const fetchConfig = async () => {
      const cfg = await api.getConfig();
      if (cfg?.colors) {
        setColorSettings(prev => ({
          nodes: { ...prev.nodes, ...(cfg.colors?.nodes || {}) },
          edges: { ...prev.edges, ...(cfg.colors?.edges || {}) }
        }));
        applyThemeColors(cfg.colors);
      }
    };
    fetchConfig();
  }, [effectiveVersion]);

  const getTypeColor = useCallback((type: string) => {
    return colorSettings.nodes[type] || (type === 'codemap' ? (colorSettings.nodes.codemap || '#06b6d4') : '#94a3b8');
  }, [colorSettings]);

  const getEdgeColor = useCallback((type: string) => {
    return colorSettings.edges[type] || (type === 'imports' ? (colorSettings.edges.imports || '#38bdf8') : 'var(--border-color)');
  }, [colorSettings]);

  // Synchronize D3 visual nodes and edges immediately when colorSettings updates
  useEffect(() => {
    if (nodeSelectionRef.current) {
      nodeSelectionRef.current.select('.node-circle')
        .attr('fill', (d: any) => getTypeColor(d.type));
      nodeSelectionRef.current.select('.node-label')
        .attr('fill', (d: any) => d.type === 'codemap' ? (colorSettings.nodes.codemap || '#06b6d4') : 'var(--text-main)');
    }
    if (linkSelectionRef.current) {
      linkSelectionRef.current
        .attr('stroke', (d: any) => getEdgeColor(d.type));
    }
  }, [colorSettings, getTypeColor, getEdgeColor]);

  // Multi-Hop Visual Filter & Spotlight Overlay (Non-Destructive Styling)
  const applyActiveFilterStyling = useCallback(() => {
    if (!nodeSelectionRef.current || !linkSelectionRef.current) return;

    const { nodes } = rawGraphDataRef.current;
    if (!nodes || nodes.length === 0) return;

    const query = debouncedQuery.trim().toLowerCase();
    const hasActiveFilter = Boolean(query || selectedType !== 'all');
    const isFiltering = Boolean(query || selectedType !== 'all' || focusAnchorId);

    // Compute Tier 1 (Match Set)
    const tier1Set = new Set<string>();
    
    // Helper to check if a node matches the active type/query filter
    const matchesFilter = (n: any) => {
      const matchesType = selectedType === 'all' || n.type === selectedType;
      const matchesQuery = !query || 
        n.title?.toLowerCase().includes(query) || 
        n.content?.toLowerCase().includes(query) ||
        n.id?.toLowerCase().includes(query);
      return matchesType && matchesQuery;
    };

    if (hasActiveFilter) {
      for (const n of nodes) {
        if (matchesFilter(n)) {
          tier1Set.add(n.id);
        }
      }
      if (focusAnchorId) {
        // Keep the orbit center highlighted as Tier 1
        tier1Set.add(focusAnchorId);
      }
    } else if (focusAnchorId) {
      tier1Set.add(focusAnchorId);
    }

    const hasNoMatches = isFiltering && tier1Set.size === 0;

    // Compute Tier 2 (1-Hop Direct Neighbors)
    const tier2Set = new Set<string>();
    if (!hasNoMatches && scopeDepth >= 1 && tier1Set.size > 0) {
      for (const matchId of tier1Set) {
        const neighbors = adjacencyRef.current.get(matchId);
        if (neighbors) {
          for (const nb of neighbors) {
            if (!tier1Set.has(nb)) {
              tier2Set.add(nb);
            }
          }
        }
      }
    }

    // Compute Tier 3 (2-Hop Extended Neighbors)
    const tier3Set = new Set<string>();
    if (!hasNoMatches && scopeDepth >= 2 && tier2Set.size > 0) {
      for (const hop1Id of tier2Set) {
        const extended = adjacencyRef.current.get(hop1Id);
        if (extended) {
          for (const ext of extended) {
            if (!tier1Set.has(ext) && !tier2Set.has(ext)) {
              tier3Set.add(ext);
            }
          }
        }
      }
    }

    // In-scope union for stats
    const inScopeSet = new Set<string>([...tier1Set, ...tier2Set, ...tier3Set]);

    activeTier1SetRef.current = tier1Set;
    activeInScopeSetRef.current = inScopeSet;

    setMatchStats({
      matchCount: tier1Set.size,
      inScopeCount: inScopeSet.size,
      totalCount: nodes.length,
      isFiltering,
      hasNoMatches,
    });

    // Interrupt any ongoing style transitions
    nodeSelectionRef.current.interrupt('style');
    linkSelectionRef.current.interrupt('style');

    // If not filtering OR if 0 matches, show full baseline graph
    if (!isFiltering || hasNoMatches) {
      activeTier1SetRef.current.clear();
      activeInScopeSetRef.current.clear();

      nodeSelectionRef.current
        .transition('style')
        .duration(200)
        .style('opacity', 1.0)
        .style('pointer-events', 'auto')
        .style('filter', 'none');

      nodeSelectionRef.current.select('.node-circle')
        .transition('style')
        .duration(200)
        .attr('r', (d: any) => d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6))
        .attr('stroke', 'var(--bg-color)')
        .attr('stroke-width', 2);

      nodeSelectionRef.current.select('.node-label')
        .transition('style')
        .duration(200)
        .style('opacity', 1.0)
        .style('font-weight', (d: any) => d.type === 'codemap' ? '600' : '400');

      linkSelectionRef.current
        .transition('style')
        .duration(200)
        .attr('stroke-opacity', 0.6)
        .attr('stroke-width', (d: any) => d.type === 'imports' ? 1.5 : 2);

      return;
    }

    nodeSelectionRef.current
      .transition('style')
      .duration(220)
      .style('opacity', (d: any) => {
        if (tier1Set.has(d.id)) return 1.0;
        if (tier2Set.has(d.id)) return 0.75;
        if (tier3Set.has(d.id)) return 0.50;
        return 0.25; // Tier 4: Ambient
      })
      .style('pointer-events', (d: any) => {
        if (inScopeSet.has(d.id)) return 'auto';
        return 'none'; // Disable pointer events on ambient nodes to prevent accidental hover resets
      })
      .style('filter', (d: any) => {
        if (tier1Set.has(d.id) || tier2Set.has(d.id) || tier3Set.has(d.id)) return 'none';
        return 'grayscale(0.6)';
      });

    nodeSelectionRef.current.select('.node-circle')
      .transition('style')
      .duration(220)
      .attr('r', (d: any) => {
        const base = d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6);
        if (tier1Set.has(d.id)) return base + 3;
        return base;
      })
      .attr('stroke', (d: any) => {
        if (tier1Set.has(d.id)) return '#38bdf8';
        if (tier2Set.has(d.id)) return 'var(--text-main)';
        return 'var(--bg-color)';
      })
      .attr('stroke-width', (d: any) => {
        if (tier1Set.has(d.id)) return 3;
        if (tier2Set.has(d.id)) return 2;
        return 1;
      });

    nodeSelectionRef.current.select('.node-label')
      .transition('style')
      .duration(220)
      .style('opacity', (d: any) => {
        if (tier1Set.has(d.id)) return 1.0;
        if (tier2Set.has(d.id)) return 0.85;
        if (tier3Set.has(d.id)) return 0.50;
        return 0.0; // Ambient labels hidden until hovered
      })
      .style('font-weight', (d: any) => {
        if (tier1Set.has(d.id)) return '700';
        if (tier2Set.has(d.id)) return '600';
        return '400';
      });

    // Link Styling Across Tiers
    linkSelectionRef.current
      .transition('style')
      .duration(220)
      .attr('stroke-opacity', (l: any) => {
        const srcId = typeof l.source === 'object' ? l.source.id : l.source;
        const tgtId = typeof l.target === 'object' ? l.target.id : l.target;

        const srcTier1 = tier1Set.has(srcId);
        const tgtTier1 = tier1Set.has(tgtId);
        const srcInScope = inScopeSet.has(srcId);
        const tgtInScope = inScopeSet.has(tgtId);

        if (srcTier1 && tgtTier1) return 0.95;
        if ((srcTier1 && tgtInScope) || (tgtTier1 && srcInScope)) return 0.75;
        if (srcInScope && tgtInScope) return 0.50;
        return 0.08; // Ambient edge
      })
      .attr('stroke-width', (l: any) => {
        const srcId = typeof l.source === 'object' ? l.source.id : l.source;
        const tgtId = typeof l.target === 'object' ? l.target.id : l.target;

        if (tier1Set.has(srcId) && tier1Set.has(tgtId)) return 2.8;
        if (inScopeSet.has(srcId) && inScopeSet.has(tgtId)) return 1.8;
        return 0.8;
      });

  }, [debouncedQuery, selectedType, scopeDepth, focusAnchorId]);

  const applyActiveFilterStylingRef = useRef(applyActiveFilterStyling);
  useEffect(() => {
    applyActiveFilterStylingRef.current = applyActiveFilterStyling;
  }, [applyActiveFilterStyling]);

  // 1. D3 Graph Simulation & Geometry Lifecycle with Incremental Position Preservation
  useEffect(() => {
    if (!activeContext || !svgRef.current) return;

    let isMounted = true;

    const initGraph = async () => {
      const rawData = await api.getGraph(activeContext);
      if (!isMounted || !rawData || !rawData.nodes) return;

      const width = svgRef.current?.parentElement?.clientWidth || 900;
      const height = svgRef.current?.parentElement?.clientHeight || 700;

      // Check if switching context
      const isContextSwitch = previousContextRef.current !== activeContext;
      if (isContextSwitch) {
        previousContextRef.current = activeContext;
        positionsCacheRef.current.clear();
        currentZoomTransformRef.current = null;
        isInitializedRef.current = false;
        if (simulationRef.current) {
          simulationRef.current.stop();
          simulationRef.current = null;
        }
        d3.select(svgRef.current).selectAll('*').remove();
        containerRef.current = null;
      }

      // Filter valid links where both source & target exist in nodes
      const nodeIds = new Set((rawData.nodes || []).map((n: any) => n.id));
      const validLinks = (rawData.links || []).filter(
        (l: any) => nodeIds.has(typeof l.source === 'object' ? l.source.id : l.source) &&
                    nodeIds.has(typeof l.target === 'object' ? l.target.id : l.target)
      );

      const positionsCache = positionsCacheRef.current;

      // Map nodes with persistent positions or proximity-based placement for new nodes
      const nodes = (rawData.nodes || []).map((n: any) => {
        const cached = positionsCache.get(n.id);
        if (cached) {
          return {
            ...n,
            x: cached.x,
            y: cached.y,
            vx: cached.vx ?? 0,
            vy: cached.vy ?? 0,
            fx: cached.fx ?? null,
            fy: cached.fy ?? null,
          };
        }

        // New node: Proximity-based spawning near a connected neighbor
        let spawnX = width / 2 + (Math.random() - 0.5) * 80;
        let spawnY = height / 2 + (Math.random() - 0.5) * 80;

        const connectedLink = validLinks.find((l: any) => {
          const s = typeof l.source === 'object' ? l.source.id : l.source;
          const t = typeof l.target === 'object' ? l.target.id : l.target;
          return (s === n.id && positionsCache.has(t)) || (t === n.id && positionsCache.has(s));
        });

        if (connectedLink) {
          const s = typeof connectedLink.source === 'object' ? connectedLink.source.id : connectedLink.source;
          const t = typeof connectedLink.target === 'object' ? connectedLink.target.id : connectedLink.target;
          const neighborId = s === n.id ? t : s;
          const neighborPos = positionsCache.get(neighborId);
          if (neighborPos) {
            spawnX = neighborPos.x + (Math.random() - 0.5) * 50;
            spawnY = neighborPos.y + (Math.random() - 0.5) * 50;
          }
        }

        return {
          ...n,
          x: spawnX,
          y: spawnY,
          vx: 0,
          vy: 0,
        };
      });

      // Normalize links
      const links = validLinks.map((l: any) => ({
        source: typeof l.source === 'object' ? l.source.id : l.source,
        target: typeof l.target === 'object' ? l.target.id : l.target,
        type: l.type,
      }));

      rawGraphDataRef.current = { nodes, links };

      // Compute type distributions
      const counts: Record<string, number> = { all: nodes.length };
      for (const n of nodes) {
        counts[n.type] = (counts[n.type] || 0) + 1;
      }
      setTypeCounts(counts);

      // Build O(1) adjacency lookup graph
      const adj = new Map<string, Set<string>>();
      for (const n of nodes) {
        adj.set(n.id, new Set());
      }
      for (const l of links) {
        const src = l.source;
        const tgt = l.target;
        if (!adj.has(src)) adj.set(src, new Set());
        if (!adj.has(tgt)) adj.set(tgt, new Set());
        adj.get(src)!.add(tgt);
        adj.get(tgt)!.add(src);
      }
      adjacencyRef.current = adj;

      // Extract modules and compute centroids for modular clustering
      const fileToModuleMap = new Map<string, string>();
      for (const n of nodes) {
        if (n.type === 'codemap' || n.id.startsWith('file_')) {
          fileToModuleMap.set(n.id, getModuleName(n));
        }
      }

      const moduleSet = new Set<string>();
      for (const n of nodes) {
        if (n.type === 'codemap' || n.id.startsWith('file_')) {
          n.module = getModuleName(n);
        } else {
          // Attached memories inherit target file module
          const connectedLink = links.find((l: any) =>
            (l.source === n.id && fileToModuleMap.has(l.target)) ||
            (l.target === n.id && fileToModuleMap.has(l.source))
          );
          if (connectedLink) {
            const fileId = fileToModuleMap.has(connectedLink.source) ? connectedLink.source : connectedLink.target;
            n.module = fileToModuleMap.get(fileId) || '_memories';
          } else {
            n.module = n.context === '_global' ? '_global' : '_memories';
          }
        }
        moduleSet.add(n.module);
      }

      const moduleList = Array.from(moduleSet).sort();
      const moduleCentroids: Record<string, { x: number; y: number }> = {};
      const clusterRadius = Math.min(width, height) * 0.32;
      moduleList.forEach((mod, idx) => {
        const angle = (2 * Math.PI * idx) / Math.max(1, moduleList.length);
        moduleCentroids[mod] = {
          x: width / 2 + clusterRadius * Math.cos(angle),
          y: height / 2 + clusterRadius * Math.sin(angle),
        };
      });

      for (const n of nodes) {
        n.moduleCentroid = moduleCentroids[n.module] || { x: width / 2, y: height / 2 };
      }

      const svg = d3.select(svgRef.current).attr('viewBox', [0, 0, width, height]);

      // Initialize zoom container if not present
      let container = containerRef.current;
      if (!container || svg.select('.zoom-container').empty()) {
        container = svg.append('g').attr('class', 'zoom-container');
        containerRef.current = container;

        const zoom = d3.zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.15, 6])
          .on('zoom', (event) => {
            currentZoomTransformRef.current = event.transform;
            container!.attr('transform', event.transform);
          });

        zoomBehaviorRef.current = zoom;
        svg.call(zoom as any);

        if (currentZoomTransformRef.current) {
          svg.call(zoom.transform as any, currentZoomTransformRef.current);
        }
      }

      // Ensure persistent g groups for orbit guides, links, and nodes
      let guideGroup = container.select<SVGGElement>('g.graph-orbit-guides');
      if (guideGroup.empty()) {
        guideGroup = container.append('g').attr('class', 'graph-orbit-guides');
      }

      let linkGroup = container.select<SVGGElement>('g.graph-links');
      if (linkGroup.empty()) {
        linkGroup = container.append('g').attr('class', 'graph-links');
      }

      let nodeGroup = container.select<SVGGElement>('g.graph-nodes');
      if (nodeGroup.empty()) {
        nodeGroup = container.append('g').attr('class', 'graph-nodes');
      }

      // Initialize or update D3 Force Simulation with Barnes-Hut, modular clustering, and physics preset
      const effectivePhysics = physics.activePreset === 'auto'
        ? { ...getAutoPreset(nodes.length), activePreset: 'auto' as const }
        : physics;

      let simulation = simulationRef.current;
      const isFirstLoad = !isInitializedRef.current || !simulation;

      if (!simulation) {
        simulation = d3.forceSimulation()
          .force('link', d3.forceLink().id((d: any) => d.id).distance(effectivePhysics.linkDistance))
          .force('charge', d3.forceManyBody().strength(effectivePhysics.chargeStrength).theta(0.85).distanceMax(450))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collide', d3.forceCollide(effectivePhysics.collisionRadius))
          .force('moduleX', d3.forceX((d: any) => d.moduleCentroid?.x || width / 2).strength(effectivePhysics.moduleGravity))
          .force('moduleY', d3.forceY((d: any) => d.moduleCentroid?.y || height / 2).strength(effectivePhysics.moduleGravity))
          .alphaDecay(0.045)
          .velocityDecay(0.45);

        simulationRef.current = simulation;
      }

      simulation.nodes(nodes as any);
      (simulation.force('link') as d3.ForceLink<any, any>).links(links as any);

      // Pre-warming on First Load vs Gentle Re-heat on Refresh
      if (isFirstLoad) {
        // Pre-warm initial layout synchronously for 35 ticks
        simulation.alpha(1);
        for (let i = 0; i < 35; ++i) {
          simulation.tick();
        }
        isInitializedRef.current = true;
      } else {
        // Warm restart with low alpha so existing nodes gently nudge without scattering
        simulation.alpha(0.12).restart();
      }

      // Data Join for Links (keyed by source->target)
      const link = linkGroup
        .selectAll<SVGLineElement, any>('line')
        .data(links, (d: any) => {
          const s = typeof d.source === 'object' ? d.source.id : d.source;
          const t = typeof d.target === 'object' ? d.target.id : d.target;
          return `${s}->${t}`;
        })
        .join(
          enter => enter.append('line')
            .attr('stroke', (d: any) => getEdgeColor(d.type))
            .attr('stroke-dasharray', (d: any) => d.type === 'imports' ? '4 2' : 'none')
            .attr('stroke-width', (d: any) => d.type === 'imports' ? 1.5 : 2)
            .attr('stroke-opacity', 0.6),
          update => update
            .attr('stroke', (d: any) => getEdgeColor(d.type)),
          exit => exit.remove()
        );

      linkSelectionRef.current = link as any;

      // Data Join for Nodes (keyed by d.id)
      const node = nodeGroup
        .selectAll<SVGGElement, any>('g.node-item')
        .data(nodes as any, (d: any) => d.id)
        .join(
          enter => {
            const g = enter.append('g')
              .attr('class', 'node-item')
              .style('cursor', 'pointer')
              .call(d3.drag()
                .filter((event: any) => {
                  if (layoutModeRef.current === 'orbit') return false;
                  return !event.ctrlKey && !event.button;
                })
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended) as any);

            g.append('circle')
              .attr('class', 'node-circle')
              .attr('r', (d: any) => d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6))
              .attr('fill', (d: any) => getTypeColor(d.type))
              .attr('stroke', 'var(--bg-color)')
              .attr('stroke-width', 2);

            g.append('text')
              .attr('class', 'node-label')
              .text((d: any) => d.title)
              .attr('x', 14)
              .attr('y', 4)
              .attr('fill', (d: any) => d.type === 'codemap' ? (colorSettings.nodes.codemap || '#06b6d4') : 'var(--text-main)')
              .style('font-size', (d: any) => d.type === 'codemap' ? '11px' : '12px')
              .style('font-weight', (d: any) => d.type === 'codemap' ? '600' : '400')
              .style('user-select', 'none');

            // Click: Center in Orbit mode, or Open Memory Editor in Force mode
            g.on('click', (_event: any, d: any) => {
              if (layoutModeRef.current === 'orbit') {
                setFocusAnchorId(d.id);
                setFocusAnchorTitle(d.title);
              } else if (!d.id.startsWith('file_')) {
                setEditingId(d.id);
              }
            });

            // ContextMenu / Right-click: Focus from here
            g.on('contextmenu', (event: any, d: any) => {
              event.preventDefault();
              setFocusAnchorId(prev => (prev === d.id ? null : d.id));
              setFocusAnchorTitle(prev => (prev === d.title ? null : d.title));
            });

            g.on('mouseenter', (_event: any, d: any) => {
              const neighbors = adjacencyRef.current.get(d.id) || new Set();
              
              if (linkSelectionRef.current) {
                linkSelectionRef.current
                  .transition()
                  .duration(120)
                  .attr('stroke-opacity', (l: any) => {
                    const srcId = typeof l.source === 'object' ? l.source.id : l.source;
                    const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
                    
                    if (srcId === d.id || tgtId === d.id) return 1.0;

                    // Preserve active filter styling for other links
                    const srcTier1 = activeTier1SetRef.current.has(srcId);
                    const tgtTier1 = activeTier1SetRef.current.has(tgtId);
                    const srcInScope = activeInScopeSetRef.current.has(srcId);
                    const tgtInScope = activeInScopeSetRef.current.has(tgtId);

                    if (srcTier1 && tgtTier1) return 0.95;
                    if ((srcTier1 && tgtInScope) || (tgtTier1 && srcInScope)) return 0.75;
                    if (srcInScope && tgtInScope) return 0.50;
                    return 0.08;
                  })
                  .attr('stroke-width', (l: any) => {
                    const srcId = typeof l.source === 'object' ? l.source.id : l.source;
                    const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
                    
                    if (srcId === d.id || tgtId === d.id) return 2.5;
                    return l.type === 'imports' ? 1.5 : 2;
                  });
              }

              if (nodeSelectionRef.current) {
                nodeSelectionRef.current.select('.node-label')
                  .filter((n: any) => n.id === d.id || neighbors.has(n.id))
                  .transition()
                  .duration(120)
                  .style('opacity', 1.0);
              }
            });

            g.on('mouseleave', () => {
              applyActiveFilterStylingRef.current();
            });

            return g;
          },
          update => {
            update.select('.node-circle')
              .attr('r', (d: any) => d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6))
              .attr('fill', (d: any) => getTypeColor(d.type));

            update.select('.node-label')
              .text((d: any) => d.title)
              .attr('fill', (d: any) => d.type === 'codemap' ? (colorSettings.nodes.codemap || '#06b6d4') : 'var(--text-main)');

            return update;
          },
          exit => exit.remove()
        );

      nodeSelectionRef.current = node as any;

      simulation.on('tick', () => {
        // Update persistent position cache
        for (const d of nodes) {
          if (d.x !== undefined && d.y !== undefined) {
            positionsCacheRef.current.set(d.id, {
              x: d.x,
              y: d.y,
              vx: d.vx,
              vy: d.vy,
              fx: d.fx,
              fy: d.fy,
            });
          }
        }

        link
          .attr('x1', (d: any) => d.source.x)
          .attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x)
          .attr('y2', (d: any) => d.target.y);

        node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
      });

      // Synchronously position elements once immediately after pre-warming
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);

      function dragstarted(event: any, d: any) {
        if (layoutModeRef.current === 'orbit') return;
        if (!event.active) simulation!.alphaTarget(0.2).restart();
        d.fx = d.x;
        d.fy = d.y;
      }
      
      function dragged(event: any, d: any) {
        if (layoutModeRef.current === 'orbit') return;
        d.fx = event.x;
        d.fy = event.y;
      }
      
      function dragended(event: any, d: any) {
        if (layoutModeRef.current === 'orbit') return;
        if (!event.active) simulation!.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }

      // Initial filter styling pass
      applyActiveFilterStylingRef.current();
    };

    initGraph();

    return () => {
      isMounted = false;
    };
  }, [activeContext, effectiveVersion, getTypeColor]);

  // Live Physics Updates (when sliders move or preset changes)
  useEffect(() => {
    const simulation = simulationRef.current;
    if (!simulation || layoutMode !== 'force') return;

    const width = svgRef.current?.parentElement?.clientWidth || 900;
    const height = svgRef.current?.parentElement?.clientHeight || 700;

    const effective = physics.activePreset === 'auto' && rawGraphDataRef.current.nodes.length > 0
      ? { ...getAutoPreset(rawGraphDataRef.current.nodes.length), activePreset: 'auto' as const }
      : physics;

    simulation
      .force('charge', d3.forceManyBody().strength(effective.chargeStrength).theta(0.85).distanceMax(450))
      .force('collide', d3.forceCollide(effective.collisionRadius))
      .force('moduleX', d3.forceX((d: any) => d.moduleCentroid?.x || width / 2).strength(effective.moduleGravity))
      .force('moduleY', d3.forceY((d: any) => d.moduleCentroid?.y || height / 2).strength(effective.moduleGravity));

    const linkForce = simulation.force('link') as d3.ForceLink<any, any>;
    if (linkForce) {
      linkForce.distance(effective.linkDistance);
    }

    simulation.alpha(0.25).restart();
  }, [physics, layoutMode]);

  // Ego Radial Orbit Calculation & Transition
  useEffect(() => {
    const simulation = simulationRef.current;
    const container = containerRef.current;
    if (!container || !nodeSelectionRef.current || !linkSelectionRef.current) return;

    const width = svgRef.current?.parentElement?.clientWidth || 900;
    const height = svgRef.current?.parentElement?.clientHeight || 700;
    const centerX = width / 2;
    const centerY = height / 2;

    const guideGroup = container.select<SVGGElement>('g.graph-orbit-guides');

    if (layoutMode === 'orbit' && rawGraphDataRef.current.nodes.length > 0) {
      // Pause force simulation during radial orbit mode
      if (simulation) simulation.stop();

      const nodes = rawGraphDataRef.current.nodes;
      const anchorId = focusAnchorId || (nodes[0]?.id ?? null);
      if (!focusAnchorId && anchorId) {
        setFocusAnchorId(anchorId);
        setFocusAnchorTitle(nodes[0]?.title ?? anchorId);
      }

      // Calculate hop distances from focal anchor
      const distMap = new Map<string, number>();
      if (anchorId) {
        distMap.set(anchorId, 0);
        const queue: Array<{ id: string; dist: number }> = [{ id: anchorId, dist: 0 }];
        const visited = new Set<string>([anchorId]);

        while (queue.length > 0) {
          const { id, dist } = queue.shift()!;
          const neighbors = adjacencyRef.current.get(id);
          if (neighbors) {
            for (const nb of neighbors) {
              if (!visited.has(nb)) {
                visited.add(nb);
                distMap.set(nb, dist + 1);
                if (dist + 1 < 3) {
                  queue.push({ id: nb, dist: dist + 1 });
                }
              }
            }
          }
        }
      }

      // Group nodes by orbit tier
      const tier0 = nodes.filter(n => n.id === anchorId);
      const tier1 = nodes.filter(n => n.id !== anchorId && distMap.get(n.id) === 1);
      const tier2 = nodes.filter(n => n.id !== anchorId && distMap.get(n.id) === 2);
      const ambient = nodes.filter(n => n.id !== anchorId && (distMap.get(n.id) === undefined || distMap.get(n.id)! > 2));

      const r1 = 180;
      const r2 = 330;
      const r3 = 480;

      // Assign target coordinates
      if (tier0.length > 0) {
        tier0[0].x = centerX;
        tier0[0].y = centerY;
        tier0[0].fx = centerX;
        tier0[0].fy = centerY;
      }

      tier1.forEach((n, idx) => {
        const angle = (2 * Math.PI * idx) / Math.max(1, tier1.length) - Math.PI / 2;
        n.x = centerX + r1 * Math.cos(angle);
        n.y = centerY + r1 * Math.sin(angle);
        n.fx = n.x;
        n.fy = n.y;
      });

      tier2.forEach((n, idx) => {
        const angle = (2 * Math.PI * idx) / Math.max(1, tier2.length) - Math.PI / 2 + (Math.PI / Math.max(1, tier2.length));
        n.x = centerX + r2 * Math.cos(angle);
        n.y = centerY + r2 * Math.sin(angle);
        n.fx = n.x;
        n.fy = n.y;
      });

      ambient.forEach((n, idx) => {
        const angle = (2 * Math.PI * idx) / Math.max(1, ambient.length);
        n.x = centerX + r3 * Math.cos(angle);
        n.y = centerY + r3 * Math.sin(angle);
        n.fx = n.x;
        n.fy = n.y;
      });

      // Render concentric guide circles
      if (!guideGroup.empty()) {
        const rings = [
          { r: r1, label: '1-Hop Direct' },
          { r: r2, label: '2-Hop Extended' },
          { r: r3, label: 'Ambient Outer' },
        ];

        guideGroup.selectAll('*').remove();

        const ringItems = guideGroup.selectAll('g.orbit-ring')
          .data(rings)
          .enter()
          .append('g')
          .attr('class', 'orbit-ring');

        ringItems.append('circle')
          .attr('cx', centerX)
          .attr('cy', centerY)
          .attr('r', d => d.r)
          .attr('fill', 'none')
          .attr('stroke', 'rgba(148, 163, 184, 0.22)')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '5 5');

        ringItems.append('text')
          .attr('x', centerX + 8)
          .attr('y', d => centerY - d.r + 14)
          .attr('fill', 'rgba(148, 163, 184, 0.5)')
          .attr('font-size', '10px')
          .attr('font-weight', '500')
          .attr('letter-spacing', '0.5px')
          .text(d => d.label);
      }

      // Disable pointer events on node items during transition to avoid stuck hovers
      const nodesGroup = container.select('g.graph-nodes');
      nodesGroup.style('pointer-events', 'none');
      setTimeout(() => {
        nodesGroup.style('pointer-events', '');
      }, 700);

      // Animate nodes and links into orbit positions
      nodeSelectionRef.current
        .transition('layout')
        .duration(650)
        .ease(d3.easeCubicOut)
        .attr('transform', (d: any) => `translate(${d.x},${d.y})`);

      linkSelectionRef.current
        .transition('layout')
        .duration(650)
        .ease(d3.easeCubicOut)
        .attr('x1', (d: any) => d.source.x ?? (typeof d.source === 'object' ? d.source.x : centerX))
        .attr('y1', (d: any) => d.source.y ?? (typeof d.source === 'object' ? d.source.y : centerY))
        .attr('x2', (d: any) => d.target.x ?? (typeof d.target === 'object' ? d.target.x : centerX))
        .attr('y2', (d: any) => d.target.y ?? (typeof d.target === 'object' ? d.target.y : centerY));

      applyActiveFilterStylingRef.current();

    } else if (layoutMode === 'force') {
      // Clear orbit guide rings
      if (!guideGroup.empty()) {
        guideGroup.selectAll('*').remove();
      }

      // Unfix positions so force simulation takes back over
      const nodes = rawGraphDataRef.current.nodes;
      for (const n of nodes) {
        n.fx = null;
        n.fy = null;
      }

      if (simulation) {
        simulation.alpha(0.3).restart();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutMode, focusAnchorId]);

  // Trigger filter updates on filter state changes
  useEffect(() => {
    applyActiveFilterStyling();
  }, [debouncedQuery, selectedType, scopeDepth, focusAnchorId, applyActiveFilterStyling]);

  const clearAllFilters = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    setSelectedType('all');
    setFocusAnchorId(null);
    setFocusAnchorTitle(null);
  };

  return (
    <div className="graph-container" style={{ width: '100%', height: 'calc(100vh - 40px)', position: 'relative', overflow: 'hidden' }}>
      {/* Top Header Title */}
      <div className="page-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(10px)', padding: '15px 30px' }}>
        <h2>Graph View ({activeContext})</h2>
      </div>

      {/* Floating Glassmorphic Command & Filter HUD */}
      {isToolbarCollapsed ? (
        <button
          className="graph-floating-toggle-btn"
          onClick={toggleToolbarCollapse}
          title="Expand Filter Controls (/)"
        >
          <SlidersHorizontal size={14} style={{ color: 'var(--accent-hover)' }} />
          <span>Filters & Controls</span>
          {matchStats.isFiltering && (
            <span className="graph-collapsed-filter-dot" title={`${matchStats.matchCount} matched`}>
              {matchStats.hasNoMatches ? '0' : matchStats.matchCount}
            </span>
          )}
          <ChevronDown size={13} style={{ opacity: 0.7 }} />
        </button>
      ) : (
        <div className="graph-floating-toolbar">
          {/* Top Row: Search + Layout Mode + Physics Drawer Toggle + Collapse */}
          <div className="graph-search-row">
            <div className="graph-search-input-wrapper">
              <Search size={14} className="graph-search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search graph nodes... (Press / to focus)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="graph-clear-btn" onClick={() => setSearchQuery('')} title="Clear search">
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Dynamic Match Stats Badge */}
            {matchStats.isFiltering && (
              <div className={`graph-badge ${matchStats.hasNoMatches ? 'no-match' : ''}`}>
                {matchStats.hasNoMatches ? (
                  'No matches'
                ) : (
                  `${matchStats.matchCount} matched · ${matchStats.inScopeCount} in scope`
                )}
              </div>
            )}

            {/* Layout Mode Segmented Switcher */}
            <div className="graph-layout-mode-group">
              <button
                className={`graph-layout-mode-btn ${layoutMode === 'force' ? 'active' : ''}`}
                onClick={() => {
                  setLayoutMode('force');
                  setFocusAnchorId(null);
                  setFocusAnchorTitle(null);
                }}
                title="Force-Directed Simulation Layout"
              >
                <Compass size={13} />
                <span>Force</span>
              </button>
              <button
                className={`graph-layout-mode-btn ${layoutMode === 'orbit' ? 'active' : ''}`}
                onClick={() => setLayoutMode('orbit')}
                title="Ego Radial Orbit View (concentric neighborhood rings)"
              >
                <Orbit size={13} />
                <span>Ego Orbit</span>
              </button>
            </div>

            {/* Physics Settings Toggle */}
            <button
              className={`graph-hud-icon-btn ${isPhysicsOpen ? 'active' : ''}`}
              onClick={() => setIsPhysicsOpen(prev => !prev)}
              title="Physics & Clustering Controls"
            >
              <SlidersHorizontal size={13} />
              <span>Physics</span>
              <span className="graph-preset-indicator">{physics.activePreset}</span>
            </button>

            {/* Reset button if active */}
            {(matchStats.isFiltering || focusAnchorId) && (
              <button
                onClick={clearAllFilters}
                className="graph-hud-reset-btn"
                title="Reset all filters (Esc)"
              >
                <X size={12} /> Reset
              </button>
            )}

            {/* Collapse Button */}
            <button
              className="graph-hud-collapse-btn"
              onClick={toggleToolbarCollapse}
              title="Hide / Collapse Controls"
            >
              <ChevronUp size={14} />
            </button>
          </div>

          {/* Physics Tuning Panel Drawer */}
          {isPhysicsOpen && (
            <div className="graph-physics-panel">
              <div className="graph-physics-header">
                <div className="graph-physics-title">
                  <Sparkles size={13} style={{ color: 'var(--accent-color, #38bdf8)' }} />
                  <span>Physics & Clustering Forces</span>
                </div>
                <div className="graph-physics-presets">
                  {(['auto', 'compact', 'standard', 'dense', 'massive'] as const).map(preset => (
                    <button
                      key={preset}
                      className={`graph-preset-chip ${physics.activePreset === preset ? 'active' : ''}`}
                      onClick={() => applyPreset(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="graph-physics-sliders-grid">
                {/* Repulsion / Charge */}
                <div className="graph-slider-item">
                  <div className="graph-slider-label-row">
                    <span>Repulsion (Charge)</span>
                    <span className="graph-slider-val">{physics.chargeStrength}</span>
                  </div>
                  <input
                    type="range"
                    min="-1200"
                    max="-100"
                    step="25"
                    value={physics.chargeStrength}
                    onChange={(e) => updatePhysics({ chargeStrength: Number(e.target.value), activePreset: 'custom' })}
                  />
                </div>

                {/* Link Distance */}
                <div className="graph-slider-item">
                  <div className="graph-slider-label-row">
                    <span>Link Distance</span>
                    <span className="graph-slider-val">{physics.linkDistance}px</span>
                  </div>
                  <input
                    type="range"
                    min="40"
                    max="300"
                    step="10"
                    value={physics.linkDistance}
                    onChange={(e) => updatePhysics({ linkDistance: Number(e.target.value), activePreset: 'custom' })}
                  />
                </div>

                {/* Collision Radius */}
                <div className="graph-slider-item">
                  <div className="graph-slider-label-row">
                    <span>Collision Radius</span>
                    <span className="graph-slider-val">{physics.collisionRadius}px</span>
                  </div>
                  <input
                    type="range"
                    min="15"
                    max="65"
                    step="1"
                    value={physics.collisionRadius}
                    onChange={(e) => updatePhysics({ collisionRadius: Number(e.target.value), activePreset: 'custom' })}
                  />
                </div>

                {/* Module Clustering Gravity */}
                <div className="graph-slider-item">
                  <div className="graph-slider-label-row">
                    <span>Module Clustering</span>
                    <span className="graph-slider-val">{physics.moduleGravity.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="0.50"
                    step="0.02"
                    value={physics.moduleGravity}
                    onChange={(e) => updatePhysics({ moduleGravity: Number(e.target.value), activePreset: 'custom' })}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Focus Anchor Badge (When right-clicked / pinned or in orbit mode) */}
          {focusAnchorId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {layoutMode === 'orbit' ? 'Orbit Center:' : 'Focal Anchor:'}
              </span>
              <div className="graph-focus-anchor-badge">
                <Crosshair size={12} />
                <span>{focusAnchorTitle || focusAnchorId}</span>
                <button 
                  onClick={() => { setFocusAnchorId(null); setFocusAnchorTitle(null); }}
                  style={{ background: 'transparent', border: 'none', color: '#c4b5fd', cursor: 'pointer', padding: 0, display: 'flex' }}
                >
                  <X size={11} />
                </button>
              </div>
              {layoutMode === 'orbit' && (
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  (Click any node to re-center orbit)
                </span>
              )}
            </div>
          )}

          {/* Type Filter Pills */}
          <div className="graph-type-pills-row">
            {MEMORY_TYPES.map((type) => {
              const count = typeCounts[type] || 0;
              const isActive = selectedType === type;
              const typeColor = type === 'all' ? 'var(--text-muted)' : getTypeColor(type);
              const label = type === 'codemap' ? 'File (codemap)' : type;
              return (
                <button
                  key={type}
                  className={`graph-type-pill ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedType(type)}
                >
                  <span
                    className="graph-type-pill-dot"
                    style={{
                      backgroundColor: typeColor,
                      boxShadow: isActive ? `0 0 6px ${typeColor}` : 'none'
                    }}
                  />
                  <span style={{ textTransform: 'capitalize' }}>{label}</span>
                  <span style={{ opacity: 0.7, fontSize: '0.68rem', marginLeft: 2 }}>({count})</span>
                </button>
              );
            })}
          </div>

          {/* Scope Depth Segmented Switcher */}
          <div className="graph-scope-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Layers size={13} style={{ color: 'var(--accent-hover)' }} />
              <span>Neighborhood Scope:</span>
            </div>
            <div className="graph-scope-segmented">
              <button
                className={`graph-scope-btn ${scopeDepth === 0 ? 'active' : ''}`}
                onClick={() => setScopeDepth(0)}
                title="Highlight only exact matches (0-hop)"
              >
                Exact (0)
              </button>
              <button
                className={`graph-scope-btn ${scopeDepth === 1 ? 'active' : ''}`}
                onClick={() => setScopeDepth(1)}
                title="Highlight matches + immediate neighbors (1-hop)"
              >
                + Direct (1-hop)
              </button>
              <button
                className={`graph-scope-btn ${scopeDepth === 2 ? 'active' : ''}`}
                onClick={() => setScopeDepth(2)}
                title="Highlight matches + extended topological paths (2-hop)"
              >
                + Extended (2-hop)
              </button>
            </div>
          </div>
        </div>
    )}

      {/* Main D3 Graph SVG */}
      <svg ref={svgRef} className="graph-svg" style={{ width: '100%', height: '100%', display: 'block' }}></svg>
      
      {/* Edit Modal */}
      {editingId && (
        <MemoryEditor
          activeContext={activeContext}
          memoryId={editingId}
          onClose={() => setEditingId(null)}
          onSave={() => {
            setEditingId(null);
            setLocalVersion(v => v + 1);
          }}
        />
      )}
    </div>
  );
};

export default GraphView;
