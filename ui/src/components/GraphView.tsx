import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { api, applyThemeColors, type GraphColorSettings, type StormDrainSettings } from '../api';
import MemoryEditor from './MemoryEditor';
import { Search, X, Crosshair, Layers, ChevronUp, ChevronDown, SlidersHorizontal, Orbit, Compass, Sparkles, Type } from 'lucide-react';


interface GraphViewProps {
  activeContext: string;
  dataVersion?: number;
}

type ScopeDepth = 0 | 1 | 2;

const MEMORY_TYPES = ['all', 'concept', 'pattern', 'guide', 'lesson', 'fact', 'warning', 'codemap', 'sequence'] as const;

import { 
  getDegreeAwareLinkDistance, 
  getEdgeStrength, 
  getRepulsionDistanceMax, 
  getCollisionRadius, 
  getMemoryChargeStrength,
  getAdaptiveAlphaDecay,
  getAdaptiveVelocityDecay
} from '../utils/physicsHelpers';

// Physics Engine Types & Presets
interface PhysicsSettings {
  chargeStrength: number;
  linkDistance: number;
  collisionRadius: number;
  moduleGravity: number;
  memoryChargeStrength?: number;
  interModuleTensionRatio?: number;
  attenuateInterModule?: boolean;
  activePreset: 'auto' | 'strongly_clustered' | 'clustered' | 'standard' | 'massive' | 'custom';
}

const PHYSICS_PRESETS: Record<string, Omit<PhysicsSettings, 'activePreset'>> = {
  strongly_clustered: { chargeStrength: -300, linkDistance: 50,  collisionRadius: 22, moduleGravity: 0.65 },
  clustered:          { chargeStrength: -250, linkDistance: 70,  collisionRadius: 27, moduleGravity: 0.44 },
  standard:           { chargeStrength: -350, linkDistance: 130, collisionRadius: 36, moduleGravity: 0.15 },
  massive:            { chargeStrength: -900, linkDistance: 220, collisionRadius: 48, moduleGravity: 0.08 },
};

const DEFAULT_PHYSICS: PhysicsSettings = { ...PHYSICS_PRESETS.clustered, activePreset: 'auto' };
const PHYSICS_STORAGE_KEY = 'stormdrain_graph_physics_settings';

interface LabelSettings {
  mode: 'all' | 'dynamic' | 'hover-only';
  filter: 'all' | 'always-show-memories';
  textBacking: boolean;
  focusMode: boolean;
}

const LABELS_STORAGE_KEY = 'stormdrain_graph_label_settings';
const DEFAULT_LABELS: LabelSettings = {
  mode: 'dynamic',
  filter: 'all',
  textBacking: true,
  focusMode: false
};

function getAutoPreset(nodeCount: number): Omit<PhysicsSettings, 'activePreset'> {
  if (nodeCount < 150) return PHYSICS_PRESETS.clustered;
  if (nodeCount < 750) return PHYSICS_PRESETS.standard;
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
  const apiGraphDataRef = useRef<{ nodes: any[]; links: any[] } | null>(null);
  const adjacencyRef = useRef<Map<string, Set<string>>>(new Map());

  // Performance & Position Preservation refs
  const isInitializedRef = useRef<boolean>(false);
  const previousContextRef = useRef<string>(activeContext);
  const positionsCacheRef = useRef<Map<string, { x: number; y: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null }>>(new Map());
  const isDraggingRef = useRef<boolean>(false);
  const pendingRefreshRef = useRef<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const currentZoomTransformRef = useRef<d3.ZoomTransform | null>(null);
  const activeTier1SetRef = useRef<Set<string>>(new Set());
  const activeInScopeSetRef = useRef<Set<string>>(new Set());
  const runIdRef = useRef<number>(0);
  const lastEffectiveVersionRef = useRef<number | string>(-1);
  const configSettingsRef = useRef<StormDrainSettings | null>(null);
  const maxUpdatedTimeRef = useRef<number>(0);

  // Newest changes highlight refs
  const activeHighlightNodesRef = useRef<Set<string>>(new Set());
  const activeHighlightLinksRef = useRef<Set<string>>(new Set());
  const highlightTimeoutRef = useRef<any>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [scopeDepth, setScopeDepth] = useState<ScopeDepth>(1);
  const [focusAnchorId, setFocusAnchorId] = useState<string | null>(null);
  const [focusAnchorTitle, setFocusAnchorTitle] = useState<string | null>(null);
  const [showConsolidated, setShowConsolidated] = useState<boolean>(() => {
    return localStorage.getItem('stormdrain_graph_show_consolidated') === 'true';
  });
  
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

  // Canvas Hybrid Renderer State & Refs
  const [renderMode, setRenderMode] = useState<'auto' | 'canvas' | 'svg'>('auto');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const quadtreeRef = useRef<d3.Quadtree<any> | null>(null);
  const isCanvasModeRef = useRef<boolean>(false);

  // Label Settings & Readability States
  const [isLabelsOpen, setIsLabelsOpen] = useState<boolean>(false);
  const [labelSettings, setLabelSettings] = useState<LabelSettings>(() => {
    try {
      const saved = localStorage.getItem(LABELS_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {}
    // Load from backend config settings if available
    const gc = configSettingsRef.current?.graph;
    return {
      mode: (gc?.labelMode as any) || DEFAULT_LABELS.mode,
      filter: (gc?.labelFilter as any) || DEFAULT_LABELS.filter,
      textBacking: gc?.labelTextBacking !== undefined ? gc.labelTextBacking : DEFAULT_LABELS.textBacking,
      focusMode: gc?.labelFocusMode !== undefined ? gc.labelFocusMode : DEFAULT_LABELS.focusMode
    };
  });

  const labelSettingsRef = useRef<LabelSettings>(labelSettings);
  useEffect(() => {
    labelSettingsRef.current = labelSettings;
  }, [labelSettings]);

  const updateLabelSettings = (updates: Partial<LabelSettings>) => {
    setLabelSettings(prev => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

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

  // References for hovering and landmarks culling
  const hoveredNodeIdRef = useRef<string | null>(null);
  const landmarkSetRef = useRef<Set<string>>(new Set());

  const getLinkKey = useCallback((l: any) => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    return `${s}->${t}`;
  }, []);

  const isNodeHighlighted = useCallback((d: any) => {
    if (!configSettingsRef.current?.graph?.highlightNewest) return false;
    return activeHighlightNodesRef.current.has(d.id);
  }, []);

  const isLinkHighlighted = useCallback((l: any) => {
    if (!configSettingsRef.current?.graph?.highlightNewest) return false;
    const key = getLinkKey(l);
    return activeHighlightLinksRef.current.has(key);
  }, [getLinkKey]);

  // Helper to extract file basenames and truncate long memory descriptions
  const getLabelText = useCallback((d: any) => {
    if (d.type === 'codemap') {
      const parts = d.title.split('/');
      return parts[parts.length - 1];
    } else {
      const title = d.title || '';
      return title.length > 32 ? title.substring(0, 29) + '...' : title;
    }
  }, []);

  // Synchronize D3 visual nodes and edges immediately when colorSettings updates
  useEffect(() => {
    if (nodeSelectionRef.current) {
      nodeSelectionRef.current.select('.node-circle')
        .attr('fill', (d: any) => getTypeColor(d.type));
      nodeSelectionRef.current.select('.node-label')
        .attr('fill', (d: any) => {
          if (isNodeHighlighted(d)) return colorSettings.highlight || '#fbbf24';
          return d.type === 'codemap' ? (colorSettings.nodes.codemap || '#06b6d4') : 'var(--text-main)';
        });
    }
    if (linkSelectionRef.current) {
      linkSelectionRef.current
        .attr('stroke', (d: any) => isLinkHighlighted(d) ? (colorSettings.highlight || '#fbbf24') : getEdgeColor(d.type));
    }
  }, [colorSettings, getTypeColor, getEdgeColor, isNodeHighlighted, isLinkHighlighted]);

  // Spatial grid partitioning algorithm to elect visible hub landmarks
  const computeSpatialLandmarks = useCallback((nodes: any[], degreeMap: Map<string, number>) => {
    if (!nodes || nodes.length === 0) return new Set<string>();

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const n of nodes) {
      if (n.x !== undefined && n.y !== undefined) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      }
    }

    // Topological fallback if simulation hasn't run/placed nodes yet
    if (minX === Infinity || minY === Infinity) {
      const sorted = [...nodes].sort((a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0));
      return new Set<string>(sorted.slice(0, Math.min(25, Math.ceil(nodes.length * 0.05))).map(n => n.id));
    }

    const width = (maxX - minX) || 1;
    const height = (maxY - minY) || 1;

    // Divide viewport into a 6x6 grid to enforce visual separation of landmarks
    const cols = 6;
    const rows = 6;
    const grid: any[][] = Array.from({ length: cols * rows }, () => []);

    for (const n of nodes) {
      if (n.x !== undefined && n.y !== undefined) {
        const col = Math.min(cols - 1, Math.max(0, Math.floor(((n.x - minX) / width) * cols)));
        const row = Math.min(rows - 1, Math.max(0, Math.floor(((n.y - minY) / height) * rows)));
        grid[row * cols + col].push(n);
      }
    }

    const landmarkSet = new Set<string>();
    for (const cellNodes of grid) {
      if (cellNodes.length === 0) continue;
      let bestNode = cellNodes[0];
      let maxDegree = degreeMap.get(bestNode.id) || 0;

      for (const cn of cellNodes) {
        const deg = degreeMap.get(cn.id) || 0;
        if (deg > maxDegree) {
          maxDegree = deg;
          bestNode = cn;
        }
      }
      landmarkSet.add(bestNode.id);
    }

    return landmarkSet;
  }, []);

  const recomputeLandmarks = useCallback(() => {
    const { nodes, links } = rawGraphDataRef.current;
    if (!nodes) return;

    const degreeMap = new Map<string, number>();
    for (const n of nodes) degreeMap.set(n.id, 0);
    for (const l of links) {
      const src = typeof l.source === 'object' ? l.source.id : l.source;
      const tgt = typeof l.target === 'object' ? l.target.id : l.target;
      degreeMap.set(src, (degreeMap.get(src) || 0) + 1);
      degreeMap.set(tgt, (degreeMap.get(tgt) || 0) + 1);
    }

    landmarkSetRef.current = computeSpatialLandmarks(nodes, degreeMap);
  }, [computeSpatialLandmarks]);

  // Direct SVG-level visibility updates for high frame rates
  const applyLabelVisibility = useCallback(() => {
    if (!nodeSelectionRef.current) return;

    const hoveredId = hoveredNodeIdRef.current;
    const neighbors = hoveredId ? (adjacencyRef.current.get(hoveredId) || new Set<string>()) : new Set<string>();

    const query = debouncedQuery.trim().toLowerCase();
    const isFiltering = Boolean(query || selectedType !== 'all' || focusAnchorId);

    const mode = labelSettingsRef.current.mode;
    const filter = labelSettingsRef.current.filter;
    const textBacking = labelSettingsRef.current.textBacking;

    // Apply backing styles (halo) and show/hide text
    nodeSelectionRef.current.select('.node-label')
      .style('paint-order', textBacking ? 'stroke fill' : 'normal')
      .style('stroke', textBacking ? 'var(--bg-color)' : 'none')
      .style('stroke-width', textBacking ? '3px' : '0px')
      .style('stroke-linecap', 'round')
      .style('stroke-linejoin', 'round')
      .style('display', (d: any) => {
        const isFile = d.type === 'codemap';

        // 1. Hover lens (always visible if node or its direct neighbor is hovered)
        if (hoveredId && (d.id === hoveredId || neighbors.has(d.id))) {
          return 'block';
        }

        // Consolidated/superseded satellite memories: hide labels unless hovered
        if (d.superseded_by) {
          return 'none';
        }

        // 2. Actively filtering (show only search matches)
        if (isFiltering) {
          const isMatch = activeTier1SetRef.current.has(d.id) || activeInScopeSetRef.current.has(d.id);
          return isMatch ? 'block' : 'none';
        }

        // 3. Filter restriction: always-show-memories
        if (filter === 'always-show-memories') {
          if (!isFile) return 'block'; // Always show memories
          if (mode === 'all') return 'block';
          if (mode === 'hover-only') return 'none';
          return landmarkSetRef.current.has(d.id) ? 'block' : 'none';
        }

        // 4. Default: mode === 'all'
        if (mode === 'all') {
          return 'block';
        }

        // 5. Default: mode === 'hover-only'
        if (mode === 'hover-only') {
          return 'none';
        }

        // 6. Default: mode === 'dynamic' (Landmarks grid)
        return landmarkSetRef.current.has(d.id) ? 'block' : 'none';
      })
      .style('opacity', (d: any) => {
        if (hoveredId && (d.id === hoveredId || neighbors.has(d.id))) {
          return 1.0;
        }
        if (isFiltering) {
          if (activeTier1SetRef.current.has(d.id)) return 1.0;
          if (activeInScopeSetRef.current.has(d.id)) return 0.75;
          return 0.0;
        }
        if (mode === 'dynamic' && landmarkSetRef.current.has(d.id)) {
          return 0.9;
        }
        return 1.0;
      });
  }, [debouncedQuery, selectedType, focusAnchorId]);

  const isCanvasMode = renderMode === 'canvas' || (renderMode === 'auto' && (rawGraphDataRef.current?.nodes?.length || 0) > 300);
  useEffect(() => {
    isCanvasModeRef.current = isCanvasMode;
  }, [isCanvasMode]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || canvas.clientWidth || 800;
    const height = rect.height || canvas.clientHeight || 600;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const transform = currentZoomTransformRef.current || d3.zoomIdentity;
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    const currentNodes = rawGraphDataRef.current?.nodes || [];
    const currentLinks = rawGraphDataRef.current?.links || [];

    // Build spatial quadtree for O(log N) hit testing
    quadtreeRef.current = d3.quadtree<any>()
      .x((d: any) => d.x || 0)
      .y((d: any) => d.y || 0)
      .addAll(currentNodes as any);

    // 1. Draw Links
    for (const l of currentLinks) {
      const s = typeof l.source === 'object' ? l.source : currentNodes.find((n: any) => n.id === l.source);
      const t = typeof l.target === 'object' ? l.target : currentNodes.find((n: any) => n.id === l.target);
      if (!s || !t || s.x == null || t.x == null) continue;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = getEdgeColor(l.type);
      ctx.lineWidth = l.type === 'imports' ? 1.2 : 1.8;
      ctx.globalAlpha = (s.superseded_by || t.superseded_by) ? 0.15 : 0.5;
      if (l.type === 'imports') {
        ctx.setLineDash([4, 3]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
    }

    // 2. Draw Nodes
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    for (const n of currentNodes) {
      if (n.x == null || n.y == null) continue;
      const isSuperseded = Boolean(n.superseded_by);
      const radius = isSuperseded ? 4 : (n.type === 'codemap' ? 9 : 7 + ((n.confidence || 0.8) * 5));
      const color = getTypeColor(n.type);

      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.globalAlpha = isSuperseded ? 0.35 : 1.0;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();

      // Recency / Search Highlight Ring
      if (activeHighlightNodesRef.current.has(n.id)) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Labels (zoom-gated when transform.k >= 0.5)
      if (transform.k >= 0.5 && n.title) {
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.fillStyle = n.type === 'codemap' ? '#38bdf8' : '#e2e8f0';
        ctx.fillText(getLabelText(n), n.x + radius + 4, n.y + 4);
      }
    }

    ctx.restore();
  }, [getTypeColor, getEdgeColor, getLabelText]);

  // Multi-Hop Visual Filter & Spotlight Overlay (Non-Destructive Styling)
  const applyActiveFilterStyling = useCallback(() => {
    if (!nodeSelectionRef.current || !linkSelectionRef.current) return;

    const { nodes } = rawGraphDataRef.current;
    if (!nodes || nodes.length === 0) return;

    const query = debouncedQuery.trim().toLowerCase();
    const hasActiveFilter = Boolean(query || selectedType !== 'all');
    const isFiltering = Boolean(query || selectedType !== 'all' || focusAnchorId);

    const highlightColor = configSettingsRef.current?.colors?.highlight || '#fbbf24';

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

    setMatchStats(prev => {
      if (
        prev.matchCount === tier1Set.size &&
        prev.inScopeCount === inScopeSet.size &&
        prev.totalCount === nodes.length &&
        prev.isFiltering === isFiltering &&
        prev.hasNoMatches === hasNoMatches
      ) {
        return prev;
      }
      return {
        matchCount: tier1Set.size,
        inScopeCount: inScopeSet.size,
        totalCount: nodes.length,
        isFiltering,
        hasNoMatches,
      };
    });

    // Interrupt any ongoing style transitions
    nodeSelectionRef.current.interrupt('style');
    linkSelectionRef.current.interrupt('style');

    const performanceThreshold = configSettingsRef.current?.graph?.performanceThreshold ?? 500;
    const useTransition = nodes.length < performanceThreshold;

    const tOrSel = (selection: any, duration: number) => {
      return useTransition ? selection.transition('style').duration(duration) : selection;
    };

    // If not filtering OR if 0 matches, show full baseline graph
    if (!isFiltering || hasNoMatches) {
      activeTier1SetRef.current.clear();
      activeInScopeSetRef.current.clear();

      tOrSel(nodeSelectionRef.current, 200)
        .style('opacity', (d: any) => d.superseded_by ? 0.35 : 1.0)
        .style('pointer-events', 'auto')
        .style('filter', 'none');

      nodeSelectionRef.current.select('.node-circle')
        .attr('r', (d: any) => d.superseded_by ? 4 : (d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6)))
        .attr('stroke', (d: any) => isNodeHighlighted(d) ? highlightColor : 'var(--bg-color)')
        .attr('stroke-width', (d: any) => isNodeHighlighted(d) ? 2.5 : 2)
        .style('filter', (d: any) => isNodeHighlighted(d) ? `drop-shadow(0 0 6px ${highlightColor})` : 'none');

      nodeSelectionRef.current.select('.node-highlight-ring')
        .attr('r', (d: any) => {
          const base = d.superseded_by ? 4 : (d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6));
          return base + 4.5;
        })
        .attr('stroke', (d: any) => isNodeHighlighted(d) ? highlightColor : 'none')
        .attr('stroke-width', (d: any) => isNodeHighlighted(d) ? 1.5 : 0)
        .attr('stroke-dasharray', '3,3')
        .attr('stroke-opacity', (d: any) => isNodeHighlighted(d) ? 0.8 : 0);

      nodeSelectionRef.current.select('.node-label')
        .text((d: any) => getLabelText(d))
        .style('font-weight', (d: any) => isNodeHighlighted(d) ? '700' : (d.type === 'codemap' ? '600' : '400'))
        .attr('fill', (d: any) => {
          if (isNodeHighlighted(d)) return highlightColor;
          return d.type === 'codemap' ? (colorSettings.nodes.codemap || '#06b6d4') : 'var(--text-main)';
        });

      applyLabelVisibility();

      const consolidatedIds = new Set(
        nodes.filter((n: any) => n.superseded_by).map((n: any) => n.id)
      );

      linkSelectionRef.current
        .attr('stroke', (d: any) => isLinkHighlighted(d) ? highlightColor : getEdgeColor(d.type))
        .attr('stroke-width', (d: any) => isLinkHighlighted(d) ? 3.5 : (d.type === 'imports' ? 1.5 : 2))
        .attr('stroke-opacity', (d: any) => {
          if (isLinkHighlighted(d)) return 0.9;
          const s = typeof d.source === 'object' ? d.source.id : d.source;
          const t = typeof d.target === 'object' ? d.target.id : d.target;
          return (consolidatedIds.has(s) || consolidatedIds.has(t)) ? 0.15 : 0.6;
        })
        .attr('stroke-dasharray', (d: any) => {
          const s = typeof d.source === 'object' ? d.source.id : d.source;
          const t = typeof d.target === 'object' ? d.target.id : d.target;
          if (consolidatedIds.has(s) || consolidatedIds.has(t)) return '2,2';
          return d.type === 'imports' ? '4 2' : 'none';
        });

      return;
    }

    tOrSel(nodeSelectionRef.current, 220)
      .style('opacity', (d: any) => {
        let baseOpacity = 0.25;
        if (tier1Set.has(d.id)) baseOpacity = 1.0;
        else if (tier2Set.has(d.id)) baseOpacity = 0.75;
        else if (tier3Set.has(d.id)) baseOpacity = 0.50;
        return d.superseded_by ? baseOpacity * 0.35 : baseOpacity;
      })
      .style('pointer-events', (d: any) => {
        if (inScopeSet.has(d.id)) return 'auto';
        return 'none';
      })
      .style('filter', (d: any) => {
        if (tier1Set.has(d.id) || tier2Set.has(d.id) || tier3Set.has(d.id)) return 'none';
        return 'grayscale(0.6)';
      });

    nodeSelectionRef.current.select('.node-circle')
      .attr('r', (d: any) => {
        const base = d.superseded_by ? 4 : (d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6));
        return tier1Set.has(d.id) ? base + 3 : base;
      })
      .attr('stroke', (d: any) => {
        if (isNodeHighlighted(d)) return highlightColor;
        if (tier1Set.has(d.id)) return '#38bdf8';
        if (tier2Set.has(d.id)) return 'var(--text-main)';
        return 'var(--bg-color)';
      })
      .attr('stroke-width', (d: any) => {
        if (isNodeHighlighted(d)) return 2.5;
        if (tier1Set.has(d.id)) return 3;
        if (tier2Set.has(d.id)) return 2;
        return 1;
      })
      .style('filter', (d: any) => isNodeHighlighted(d) ? `drop-shadow(0 0 6px ${highlightColor})` : 'none');

    nodeSelectionRef.current.select('.node-highlight-ring')
      .attr('r', (d: any) => {
        const base = d.superseded_by ? 4 : (d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6));
        const extra = tier1Set.has(d.id) ? 3 : 0;
        return base + extra + 4.5;
      })
      .attr('stroke', (d: any) => isNodeHighlighted(d) ? highlightColor : 'none')
      .attr('stroke-width', (d: any) => isNodeHighlighted(d) ? 1.5 : 0)
      .attr('stroke-dasharray', '3,3')
      .attr('stroke-opacity', (d: any) => isNodeHighlighted(d) ? 0.8 : 0);

    nodeSelectionRef.current.select('.node-label')
      .text((d: any) => getLabelText(d))
      .style('font-weight', (d: any) => {
        if (isNodeHighlighted(d)) return '700';
        if (tier1Set.has(d.id)) return '700';
        if (tier2Set.has(d.id)) return '600';
        return '400';
      })
      .attr('fill', (d: any) => {
        if (isNodeHighlighted(d)) return highlightColor;
        return d.type === 'codemap' ? (colorSettings.nodes.codemap || '#06b6d4') : 'var(--text-main)';
      });

    applyLabelVisibility();

    const consolidatedIds = new Set(
      nodes.filter((n: any) => n.superseded_by).map((n: any) => n.id)
    );

    // Link Styling Across Tiers
    linkSelectionRef.current
      .attr('stroke', (d: any) => isLinkHighlighted(d) ? highlightColor : getEdgeColor(d.type))
      .attr('stroke-opacity', (l: any) => {
        if (isLinkHighlighted(l)) return 0.9;
        const srcId = typeof l.source === 'object' ? l.source.id : l.source;
        const tgtId = typeof l.target === 'object' ? l.target.id : l.target;

        const srcTier1 = tier1Set.has(srcId);
        const tgtTier1 = tier1Set.has(tgtId);
        const srcInScope = inScopeSet.has(srcId);
        const tgtInScope = inScopeSet.has(tgtId);

        let baseOpacity = 0.08;
        if (srcTier1 && tgtTier1) baseOpacity = 0.95;
        else if ((srcTier1 && tgtInScope) || (tgtTier1 && srcInScope)) baseOpacity = 0.75;
        else if (srcInScope && tgtInScope) baseOpacity = 0.50;

        if (consolidatedIds.has(srcId) || consolidatedIds.has(tgtId)) {
          return baseOpacity * 0.25;
        }
        return baseOpacity;
      })
      .attr('stroke-width', (l: any) => {
        if (isLinkHighlighted(l)) return 3.5;
        const srcId = typeof l.source === 'object' ? l.source.id : l.source;
        const tgtId = typeof l.target === 'object' ? l.target.id : l.target;

        if (tier1Set.has(srcId) && tier1Set.has(tgtId)) return 2.8;
        if (inScopeSet.has(srcId) && inScopeSet.has(tgtId)) return 1.8;
        return 0.8;
      })
      .attr('stroke-dasharray', (d: any) => {
        const s = typeof d.source === 'object' ? d.source.id : d.source;
        const t = typeof d.target === 'object' ? d.target.id : d.target;
        if (consolidatedIds.has(s) || consolidatedIds.has(t)) return '2,2';
        return d.type === 'imports' ? '4 2' : 'none';
      });

  }, [debouncedQuery, selectedType, scopeDepth, focusAnchorId, isNodeHighlighted, isLinkHighlighted, getLabelText, colorSettings]);

  const applyActiveFilterStylingRef = useRef(applyActiveFilterStyling);
  useEffect(() => {
    applyActiveFilterStylingRef.current = applyActiveFilterStyling;
  }, [applyActiveFilterStyling]);

  useEffect(() => {
    applyLabelVisibility();
  }, [labelSettings, applyLabelVisibility]);

  // 1. D3 Graph Simulation & Geometry Lifecycle with Incremental Position Preservation
  useEffect(() => {
    if (!activeContext || !svgRef.current) return;

    let isMounted = true;
    const currentRunId = ++runIdRef.current;

    const initGraph = async () => {
      const isContextSwitch = previousContextRef.current !== activeContext;

      // Defer graph DOM re-binding while active dragging interaction or physics animation is in progress
      const isAnimating = isDraggingRef.current || Boolean(simulationRef.current && simulationRef.current.alpha() > 0.05);
      if (isAnimating && !isContextSwitch) {
        pendingRefreshRef.current = true;
        return;
      }

      if (!configSettingsRef.current) {
        const cfg = await api.getConfig();
        if (!isMounted || runIdRef.current !== currentRunId) return;
        configSettingsRef.current = cfg;
      }
      const cfg = configSettingsRef.current;

      const width = svgRef.current?.parentElement?.clientWidth || 900;
      const height = svgRef.current?.parentElement?.clientHeight || 700;

      let rawData = apiGraphDataRef.current;

      if (isContextSwitch || !rawData || lastEffectiveVersionRef.current !== effectiveVersion) {
        rawData = await api.getGraph(activeContext);
        if (!isMounted || runIdRef.current !== currentRunId || !rawData || !rawData.nodes) return;
        apiGraphDataRef.current = rawData;
        lastEffectiveVersionRef.current = effectiveVersion;
      }

      if (!isMounted || runIdRef.current !== currentRunId) return;

      // Reset state if switching context
      if (isContextSwitch) {
        previousContextRef.current = activeContext;
        lastEffectiveVersionRef.current = -1;
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

      let nodes = showConsolidated
        ? [...rawData.nodes]
        : rawData.nodes.filter((n: any) => !n.superseded_by);

      const nodeIds = new Set(nodes.map((n: any) => n.id));
      const validLinks = rawData.links.filter((l: any) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return nodeIds.has(s) && nodeIds.has(t);
      });

      const positionsCache = positionsCacheRef.current;
      const liveNodes = simulationRef.current?.nodes() || rawGraphDataRef.current?.nodes || [];
      const liveNodeMap = new Map(liveNodes.map((n: any) => [n.id, n]));

      // Map nodes with persistent positions or proximity-based placement for new nodes
      nodes = nodes.map((n: any) => {
        const live = liveNodeMap.get(n.id);
        const cached = positionsCache.get(n.id);
        const source = (live && live.x !== undefined) ? live : cached;

        if (source) {
          return {
            ...n,
            x: source.x,
            y: source.y,
            vx: 0,
            vy: 0,
            fx: source.fx ?? null,
            fy: source.fy ?? null,
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

      // Always create fresh normalized link objects with string source/target
      const links = validLinks.map((l: any) => ({
        source: typeof l.source === 'object' ? l.source.id : l.source,
        target: typeof l.target === 'object' ? l.target.id : l.target,
        type: l.type,
      }));

      // Check if layout properties changed
      const currentNodes = rawGraphDataRef.current?.nodes || [];
      const currentLinks = rawGraphDataRef.current?.links || [];
      let layoutChanged = false;

      if (nodes.length !== currentNodes.length || links.length !== currentLinks.length) {
        layoutChanged = true;
      } else {
        const oldNodeMap = new Map(currentNodes.map((n: any) => [n.id, n]));
        for (const n of nodes) {
          const oldNode = oldNodeMap.get(n.id);
          if (!oldNode || oldNode.title !== n.title || oldNode.type !== n.type || oldNode.confidence !== n.confidence) {
            layoutChanged = true;
            break;
          }
        }
        if (!layoutChanged) {
          const oldLinkSet = new Set(currentLinks.map((l: any) => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            return `${s}->${t}->${l.type}`;
          }));
          for (const l of links) {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            if (!oldLinkSet.has(`${s}->${t}->${l.type}`)) {
              layoutChanged = true;
              break;
            }
          }
        }
      }

      // Live comparison heuristic for newly added / modified nodes
      const highlightNewestEnabled = cfg?.graph?.highlightNewest;
      const timeoutMs = (cfg?.graph?.highlightTimeout || 2) * 60 * 1000;

      const parseTimestamp = (ts: any): number => {
        if (!ts) return 0;
        if (typeof ts === 'number') return ts;
        let str = String(ts).trim();
        if (!str) return 0;
        if (!str.includes('T') && str.includes(' ')) {
          str = str.replace(' ', 'T') + 'Z';
        } else if (!str.endsWith('Z') && !str.includes('+') && !str.includes('-')) {
          str = str + 'Z';
        }
        const time = new Date(str).getTime();
        return isNaN(time) ? 0 : time;
      };

      if (highlightNewestEnabled) {
        const updateTimes = nodes.map((n: any) => parseTimestamp(n.updated)).filter((t: number) => t > 0);
        maxUpdatedTimeRef.current = updateTimes.length > 0 ? Math.max(...updateTimes) : 0;

        if (isContextSwitch || currentNodes.length === 0) {
          activeHighlightNodesRef.current.clear();
          activeHighlightLinksRef.current.clear();
          if (highlightTimeoutRef.current) {
            clearTimeout(highlightTimeoutRef.current);
            highlightTimeoutRef.current = null;
          }

          if (maxUpdatedTimeRef.current > 0) {
            const timeSinceMaxUpdate = Date.now() - maxUpdatedTimeRef.current;
            if (timeSinceMaxUpdate < timeoutMs) {
              const newestTime = maxUpdatedTimeRef.current;
              // Highlight nodes created/updated within 10s margin of newest timestamp
              const margin = 10 * 1000;
              nodes.forEach((n: any) => {
                const t = parseTimestamp(n.updated);
                if (t > 0 && (newestTime - t <= margin)) {
                  // Only highlight codemap file vertices if their update is also fresh to Date.now()
                  if (n.type === 'codemap') {
                    if (Date.now() - t <= timeoutMs) {
                      activeHighlightNodesRef.current.add(n.id);
                    }
                  } else {
                    activeHighlightNodesRef.current.add(n.id);
                  }
                }
              });
              const remainingTime = timeoutMs - timeSinceMaxUpdate;
              if (remainingTime > 0) {
                highlightTimeoutRef.current = setTimeout(() => {
                  activeHighlightNodesRef.current.clear();
                  activeHighlightLinksRef.current.clear();
                  applyActiveFilterStyling();
                }, remainingTime);
              }
            }
          }
        } else {
          const prevNodesMap = new Map<string, any>(currentNodes.map((n: any) => [n.id, n]));
          const prevLinksMap = new Map<string, any>(currentLinks.map((l: any) => [getLinkKey(l), l]));

          const newHighlightNodes = new Set<string>();
          const newHighlightLinks = new Set<string>();

          nodes.forEach((n: any) => {
            const prev = prevNodesMap.get(n.id);
            if (!prev) {
              // Brand new node added in live session
              if (n.updated) {
                const t = parseTimestamp(n.updated);
                if (t > 0 && (Date.now() - t <= timeoutMs)) {
                  newHighlightNodes.add(n.id);
                }
              } else {
                newHighlightNodes.add(n.id);
              }
            } else if (n.updated && prev.updated) {
              const nTime = parseTimestamp(n.updated);
              const pTime = parseTimestamp(prev.updated);
              if (nTime > 0 && pTime > 0 && nTime > pTime) {
                newHighlightNodes.add(n.id);
              }
            }
          });

          links.forEach((l: any) => {
            const key = getLinkKey(l);
            const prev = prevLinksMap.get(key);
            if (!prev) {
              const s = typeof l.source === 'object' ? l.source.id : l.source;
              const t = typeof l.target === 'object' ? l.target.id : l.target;
              newHighlightNodes.add(s);
              newHighlightNodes.add(t);
              newHighlightLinks.add(key);
            }
          });

          const currentLinksMap = new Map<string, any>(links.map((l: any) => [getLinkKey(l), l]));
          currentLinks.forEach((l: any) => {
            const key = getLinkKey(l);
            if (!currentLinksMap.has(key)) {
              const s = typeof l.source === 'object' ? l.source.id : l.source;
              const t = typeof l.target === 'object' ? l.target.id : l.target;
              if (prevNodesMap.has(s)) newHighlightNodes.add(s);
              if (prevNodesMap.has(t)) newHighlightNodes.add(t);
            }
          });

          if (newHighlightNodes.size > 0 || newHighlightLinks.size > 0) {
            activeHighlightNodesRef.current = newHighlightNodes;
            activeHighlightLinksRef.current = newHighlightLinks;
            if (highlightTimeoutRef.current) {
              clearTimeout(highlightTimeoutRef.current);
            }
            highlightTimeoutRef.current = setTimeout(() => {
              activeHighlightNodesRef.current.clear();
              activeHighlightLinksRef.current.clear();
              applyActiveFilterStyling();
            }, timeoutMs);
          }
        }
      } else {
        activeHighlightNodesRef.current.clear();
        activeHighlightLinksRef.current.clear();
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
          highlightTimeoutRef.current = null;
        }
      }

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
        const src = typeof l.source === 'object' ? l.source.id : l.source;
        const tgt = typeof l.target === 'object' ? l.target.id : l.target;
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
          // Transitive Module Inheritance via BFS
          let targetModule = '';
          const visited = new Set<string>([n.id]);
          const queue = [n.id];
          while (queue.length > 0) {
            const currId = queue.shift()!;
            if (fileToModuleMap.has(currId)) {
              targetModule = fileToModuleMap.get(currId)!;
              break;
            }
            const neighbors = adj.get(currId);
            if (neighbors) {
              for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                  visited.add(neighbor);
                  queue.push(neighbor);
                }
              }
            }
          }
          n.module = targetModule || (n.context === '_global' ? '_global' : '_memories');
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
            if (container) container.attr('transform', event.transform);
            if (isCanvasModeRef.current) {
              drawCanvas();
            }
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

      // Compute matching subsets for Focus Mode if active
      const query = debouncedQuery.trim().toLowerCase();
      const isFiltering = Boolean(query || selectedType !== 'all' || focusAnchorId);

      const tier1Set = new Set<string>();
      const matchesFilter = (n: any) => {
        const matchesType = selectedType === 'all' || n.type === selectedType;
        const matchesQuery = !query || 
          n.title?.toLowerCase().includes(query) || 
          n.content?.toLowerCase().includes(query) ||
          n.id?.toLowerCase().includes(query);
        return matchesType && matchesQuery;
      };

      const hasActiveFilter = Boolean(query || selectedType !== 'all');
      if (hasActiveFilter) {
        for (const n of nodes) {
          if (matchesFilter(n)) {
            tier1Set.add(n.id);
          }
        }
        if (focusAnchorId) tier1Set.add(focusAnchorId);
      } else if (focusAnchorId) {
        tier1Set.add(focusAnchorId);
      }

      const hasNoMatches = isFiltering && tier1Set.size === 0;

      let nodesToBind = nodes;
      let linksToBind = links;

      if (labelSettings.focusMode && isFiltering && !hasNoMatches) {
        const tier2Set = new Set<string>();
        if (tier1Set.size > 0 && scopeDepth >= 1) {
          for (const matchId of tier1Set) {
            const neighbors = adj.get(matchId);
            if (neighbors) {
              for (const nb of neighbors) {
                if (!tier1Set.has(nb)) {
                  tier2Set.add(nb);
                }
              }
            }
          }
        }

        const tier3Set = new Set<string>();
        if (tier2Set.size > 0 && scopeDepth >= 2) {
          for (const hop1Id of tier2Set) {
            const extended = adj.get(hop1Id);
            if (extended) {
              for (const ext of extended) {
                if (!tier1Set.has(ext) && !tier2Set.has(ext)) {
                  tier3Set.add(ext);
                }
              }
            }
          }
        }

        const inScopeSet = new Set<string>([...tier1Set, ...tier2Set, ...tier3Set]);

        nodesToBind = nodes.filter((n: any) => inScopeSet.has(n.id));
        linksToBind = links.filter((l: any) => {
          const s = typeof l.source === 'object' ? l.source.id : l.source;
          const t = typeof l.target === 'object' ? l.target.id : l.target;
          return inScopeSet.has(s) && inScopeSet.has(t);
        });
      }

      // Initialize or update D3 Force Simulation with Barnes-Hut, modular clustering, and physics preset
      const effectivePhysics = physics.activePreset === 'auto'
        ? { ...getAutoPreset(nodesToBind.length), activePreset: 'auto' as const }
        : physics;

      let simulation = simulationRef.current;
      const isFirstLoad = !isInitializedRef.current || !simulation;

      if (!simulation) {
        simulation = d3.forceSimulation()
          .force('link', d3.forceLink().id((d: any) => d.id)
            .distance((link: any) => {
              const srcType = typeof link.source === 'object' ? link.source.type : '';
              const tgtType = typeof link.target === 'object' ? link.target.type : '';
              const isCodeToCode = srcType === 'codemap' && tgtType === 'codemap';
              if (isCodeToCode) return effectivePhysics.linkDistance;
              const targetNode = typeof link.target === 'object' ? link.target : link.source;
              const attachedCount = (adjacencyRef.current?.get(targetNode.id)?.size || 1) - 1;
              return getDegreeAwareLinkDistance(attachedCount, effectivePhysics.linkDistance);
            })
            .strength((link: any) => {
              const srcType = typeof link.source === 'object' ? link.source.type : '';
              const tgtType = typeof link.target === 'object' ? link.target.type : '';
              const isCodeToCode = srcType === 'codemap' && tgtType === 'codemap';
              const srcModule = typeof link.source === 'object' ? link.source.module : '';
              const tgtModule = typeof link.target === 'object' ? link.target.module : '';
              const isInterModule = isCodeToCode && srcModule !== tgtModule;
              const ratio = physics.interModuleTensionRatio ?? configSettingsRef.current?.graph?.interModuleTensionRatio ?? 0.25;
              const attenuate = physics.attenuateInterModule ?? configSettingsRef.current?.graph?.attenuateInterModule ?? true;
              return getEdgeStrength(isCodeToCode, isInterModule, 0.15, ratio, attenuate);
            })
          )
          .force('charge', d3.forceManyBody()
            .strength((d: any) => {
              if (d.superseded_by) return -5;
              const customMemoryCharge = physics.memoryChargeStrength ?? configSettingsRef.current?.graph?.memoryChargeStrength ?? -140;
              return d.type === 'codemap' ? effectivePhysics.chargeStrength : getMemoryChargeStrength(customMemoryCharge);
            })
            .theta(configSettingsRef.current?.graph?.repulsionTheta ?? 0.95)
            .distanceMax(getRepulsionDistanceMax(effectivePhysics.linkDistance, configSettingsRef.current?.graph?.repulsionDistanceMax))
          )
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collide', d3.forceCollide((d: any) => getCollisionRadius(d.type, Boolean(d.superseded_by), effectivePhysics.collisionRadius)))
          .force('moduleX', d3.forceX((d: any) => d.moduleCentroid?.x || width / 2).strength(effectivePhysics.moduleGravity))
          .force('moduleY', d3.forceY((d: any) => d.moduleCentroid?.y || height / 2).strength(effectivePhysics.moduleGravity))
          .alphaDecay(getAdaptiveAlphaDecay(nodesToBind.length))
          .velocityDecay(getAdaptiveVelocityDecay(nodesToBind.length));

        simulationRef.current = simulation;
      }

      // Check if simulation nodes list has changed
      const currentSimNodeIds = new Set(simulation.nodes().map((n: any) => n.id));
      const activeIdsChanged = currentSimNodeIds.size !== nodesToBind.length ||
        !nodesToBind.every((n: any) => currentSimNodeIds.has(n.id));

      simulation.nodes(nodesToBind as any);
      (simulation.force('link') as d3.ForceLink<any, any>).links(linksToBind as any);

      // Pre-warming on First Load vs Gentle Re-heat on Refresh
      if (isFirstLoad) {
        // Pre-warm initial layout synchronously for 35 ticks
        simulation.alpha(1);
        for (let i = 0; i < 35; ++i) {
          simulation.tick();
        }
        isInitializedRef.current = true;
        if (layoutModeRef.current === 'orbit') {
          simulation.stop();
        }
      } else if (layoutModeRef.current === 'force' && (layoutChanged || activeIdsChanged)) {
        // Warm restart with low alpha so existing nodes gently nudge without scattering
        simulation.alpha(0.2).restart();
      }

      const consolidatedNodeIds = new Set(
        nodesToBind.filter((n: any) => n.superseded_by).map((n: any) => n.id)
      );

      // Data Join for Links (keyed by source->target)
      const link = linkGroup
        .selectAll<SVGLineElement, any>('line')
        .data(linksToBind, (d: any) => {
          const s = typeof d.source === 'object' ? d.source.id : d.source;
          const t = typeof d.target === 'object' ? d.target.id : d.target;
          return `${s}->${t}`;
        })
        .join(
          enter => enter.append('line')
            .attr('stroke', (d: any) => getEdgeColor(d.type))
            .attr('stroke-dasharray', (d: any) => {
              const s = typeof d.source === 'object' ? d.source.id : d.source;
              const t = typeof d.target === 'object' ? d.target.id : d.target;
              if (consolidatedNodeIds.has(s) || consolidatedNodeIds.has(t)) return '2,2';
              return d.type === 'imports' ? '4 2' : 'none';
            })
            .attr('stroke-width', (d: any) => d.type === 'imports' ? 1.5 : 2)
            .attr('stroke-opacity', (d: any) => {
              const s = typeof d.source === 'object' ? d.source.id : d.source;
              const t = typeof d.target === 'object' ? d.target.id : d.target;
              if (consolidatedNodeIds.has(s) || consolidatedNodeIds.has(t)) return 0.15;
              return 0.6;
            }),
          update => update
            .attr('stroke', (d: any) => getEdgeColor(d.type))
            .attr('stroke-dasharray', (d: any) => {
              const s = typeof d.source === 'object' ? d.source.id : d.source;
              const t = typeof d.target === 'object' ? d.target.id : d.target;
              if (consolidatedNodeIds.has(s) || consolidatedNodeIds.has(t)) return '2,2';
              return d.type === 'imports' ? '4 2' : 'none';
            })
            .attr('stroke-opacity', (d: any) => {
              const s = typeof d.source === 'object' ? d.source.id : d.source;
              const t = typeof d.target === 'object' ? d.target.id : d.target;
              if (consolidatedNodeIds.has(s) || consolidatedNodeIds.has(t)) return 0.15;
              return 0.6;
            }),
          exit => exit.remove()
        );

      linkSelectionRef.current = link as any;

      // Data Join for Nodes (keyed by d.id)
      const node = nodeGroup
        .selectAll<SVGGElement, any>('g.node-item')
        .data(nodesToBind as any, (d: any) => d.id)
        .join(
          enter => {
            const g = enter.append('g')
              .attr('class', 'node-item')
              .style('cursor', 'pointer')
              .style('opacity', (d: any) => d.superseded_by ? 0.35 : 1)
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
              .attr('r', (d: any) => d.superseded_by ? 4 : (d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6)))
              .attr('fill', (d: any) => getTypeColor(d.type))
              .attr('stroke', 'var(--bg-color)')
              .attr('stroke-width', 2);

            g.append('circle')
              .attr('class', 'node-highlight-ring')
              .attr('fill', 'none')
              .attr('stroke', 'none')
              .attr('stroke-width', 0)
              .attr('stroke-dasharray', '3,3')
              .attr('stroke-opacity', 0);

            g.append('text')
              .attr('class', 'node-label')
              .text((d: any) => getLabelText(d))
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
              hoveredNodeIdRef.current = d.id;
              const neighbors = adjacencyRef.current.get(d.id) || new Set<string>();
              
              if (linkSelectionRef.current) {
                const isFiltering = activeTier1SetRef.current.size > 0;
                linkSelectionRef.current
                  .attr('stroke-opacity', (l: any) => {
                    const srcId = typeof l.source === 'object' ? l.source.id : l.source;
                    const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
                    if (srcId === d.id || tgtId === d.id) return 1.0;

                    if (isFiltering) {
                      const srcTier1 = activeTier1SetRef.current.has(srcId);
                      const tgtTier1 = activeTier1SetRef.current.has(tgtId);
                      const srcInScope = activeInScopeSetRef.current.has(srcId);
                      const tgtInScope = activeInScopeSetRef.current.has(tgtId);
                      if (srcTier1 && tgtTier1) return 0.95;
                      if ((srcTier1 && tgtInScope) || (tgtTier1 && srcInScope)) return 0.75;
                      if (srcInScope && tgtInScope) return 0.50;
                      return 0.08;
                    }
                    return 0.6;
                  })
                  .attr('stroke-width', (l: any) => {
                    const srcId = typeof l.source === 'object' ? l.source.id : l.source;
                    const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
                    if (srcId === d.id || tgtId === d.id) return 2.5;

                    if (isFiltering) {
                      if (activeTier1SetRef.current.has(srcId) && activeTier1SetRef.current.has(tgtId)) return 2.8;
                      if (activeInScopeSetRef.current.has(srcId) && activeInScopeSetRef.current.has(tgtId)) return 1.8;
                      return 0.8;
                    }
                    return l.type === 'imports' ? 1.5 : 2;
                  });
              }

              if (nodeSelectionRef.current) {
                nodeSelectionRef.current
                  .filter((n: any) => n.id === d.id || neighbors.has(n.id))
                  .select('.node-label')
                  .style('display', 'block')
                  .style('opacity', 1.0);
              }
            });

            g.on('mouseleave', () => {
              hoveredNodeIdRef.current = null;
              applyActiveFilterStylingRef.current();
            });

            return g;
          },
          update => {
            update.style('opacity', (d: any) => d.superseded_by ? 0.35 : 1);
            update.select('.node-circle')
              .attr('r', (d: any) => d.superseded_by ? 4 : (d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6)))
              .attr('fill', (d: any) => getTypeColor(d.type));

            update.select('.node-highlight-ring')
              .attr('fill', 'none')
              .attr('stroke', 'none');

            update.select('.node-label')
              .text((d: any) => getLabelText(d))
              .attr('fill', (d: any) => d.type === 'codemap' ? (colorSettings.nodes.codemap || '#06b6d4') : 'var(--text-main)');

            return update;
          },
          exit => exit.remove()
        );

      nodeSelectionRef.current = node as any;

      simulation.on('tick', () => {
        if (isCanvasModeRef.current) {
          drawCanvas();
        } else {
          link
            .attr('x1', (d: any) => d.source.x)
            .attr('y1', (d: any) => d.source.y)
            .attr('x2', (d: any) => d.target.x)
            .attr('y2', (d: any) => d.target.y);

          node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
        }

        if (simulation && simulation.alpha() < 0.015) {
          simulation.stop();
        }
      });

      simulation.on('end', () => {
        const currentNodes = rawGraphDataRef.current.nodes;
        for (const d of currentNodes) {
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
        recomputeLandmarks();
        applyActiveFilterStyling();

        if (pendingRefreshRef.current && !isDraggingRef.current) {
          pendingRefreshRef.current = false;
          setRefreshTrigger(prev => prev + 1);
        }
      });

      // Synchronously position elements once immediately after pre-warming
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);

      recomputeLandmarks();
      applyActiveFilterStyling();

      function dragstarted(event: any, d: any) {
        if (layoutModeRef.current === 'orbit') return;
        isDraggingRef.current = true;
        if (!event.active) simulation!.alphaTarget(0.2).restart();
        d.fx = d.x;
        d.fy = d.y;
      }
      
      function dragged(event: any, d: any) {
        if (layoutModeRef.current === 'orbit') return;
        d.fx = event.x;
        d.fy = event.y;
        d.x = event.x;
        d.y = event.y;
        if (d.x !== undefined && d.y !== undefined) {
          positionsCacheRef.current.set(d.id, {
            x: event.x,
            y: event.y,
            vx: d.vx,
            vy: d.vy,
            fx: d.fx,
            fy: d.fy,
          });
        }
      }
      
      function dragended(event: any, d: any) {
        if (layoutModeRef.current === 'orbit') return;
        if (!event.active) simulation!.alphaTarget(0);
        d.fx = null;
        d.fy = null;
        isDraggingRef.current = false;
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

        if (pendingRefreshRef.current) {
          pendingRefreshRef.current = false;
          setRefreshTrigger(prev => prev + 1);
        }
      }

      // Initial filter styling pass
      applyActiveFilterStylingRef.current();
    };

    initGraph();

    return () => {
      isMounted = false;
    };
  }, [activeContext, effectiveVersion, refreshTrigger, getTypeColor, debouncedQuery, selectedType, focusAnchorId, labelSettings.focusMode, scopeDepth, showConsolidated]);

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
      .force('charge', d3.forceManyBody()
        .strength((d: any) => {
          if (d.superseded_by) return -5;
          const customMemoryCharge = physics.memoryChargeStrength ?? configSettingsRef.current?.graph?.memoryChargeStrength ?? -140;
          return d.type === 'codemap' ? effective.chargeStrength : getMemoryChargeStrength(customMemoryCharge);
        })
        .theta(configSettingsRef.current?.graph?.repulsionTheta ?? 0.95)
        .distanceMax(getRepulsionDistanceMax(effective.linkDistance, configSettingsRef.current?.graph?.repulsionDistanceMax))
      )
      .force('collide', d3.forceCollide((d: any) => getCollisionRadius(d.type, Boolean(d.superseded_by), effective.collisionRadius)))
      .force('moduleX', d3.forceX((d: any) => d.moduleCentroid?.x || width / 2).strength(effective.moduleGravity))
      .force('moduleY', d3.forceY((d: any) => d.moduleCentroid?.y || height / 2).strength(effective.moduleGravity));

    const linkForce = simulation.force('link') as d3.ForceLink<any, any>;
    if (linkForce) {
      linkForce
        .distance((link: any) => {
          const srcType = typeof link.source === 'object' ? link.source.type : '';
          const tgtType = typeof link.target === 'object' ? link.target.type : '';
          const isCodeToCode = srcType === 'codemap' && tgtType === 'codemap';
          if (isCodeToCode) return effective.linkDistance;
          const targetNode = typeof link.target === 'object' ? link.target : link.source;
          const attachedCount = (adjacencyRef.current?.get(targetNode.id)?.size || 1) - 1;
          return getDegreeAwareLinkDistance(attachedCount, effective.linkDistance);
        })
        .strength((link: any) => {
          const srcType = typeof link.source === 'object' ? link.source.type : '';
          const tgtType = typeof link.target === 'object' ? link.target.type : '';
          const isCodeToCode = srcType === 'codemap' && tgtType === 'codemap';
          const srcModule = typeof link.source === 'object' ? link.source.module : '';
          const tgtModule = typeof link.target === 'object' ? link.target.module : '';
          const isInterModule = isCodeToCode && srcModule !== tgtModule;
          const ratio = physics.interModuleTensionRatio ?? configSettingsRef.current?.graph?.interModuleTensionRatio ?? 0.25;
          const attenuate = physics.attenuateInterModule ?? configSettingsRef.current?.graph?.attenuateInterModule ?? true;
          return getEdgeStrength(isCodeToCode, isInterModule, 0.15, ratio, attenuate);
        });
    }

    const nodeCount = rawGraphDataRef.current?.nodes?.length || 0;
    simulation
      .alphaDecay(getAdaptiveAlphaDecay(nodeCount))
      .velocityDecay(getAdaptiveVelocityDecay(nodeCount))
      .alpha(0.25)
      .restart();
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

      // Synchronize positionsCacheRef with radial orbit coordinates
      for (const n of nodes) {
        if (n.x !== undefined && n.y !== undefined) {
          positionsCacheRef.current.set(n.id, {
            x: n.x,
            y: n.y,
            vx: 0,
            vy: 0,
            fx: n.fx,
            fy: n.fy,
          });
        }
      }

      // Smoothly reset camera zoom transform if shifted, preserving frame rate on large graphs
      const currentTransform = currentZoomTransformRef.current;
      const isAlreadyIdentity = currentTransform && currentTransform.k === 1 && currentTransform.x === 0 && currentTransform.y === 0;

      if (!isAlreadyIdentity && svgRef.current && zoomBehaviorRef.current) {
        const perfThreshold = configSettingsRef.current?.graph?.performanceThreshold ?? 500;
        if (nodes.length < perfThreshold) {
          d3.select(svgRef.current)
            .transition('zoom')
            .duration(450)
            .ease(d3.easeCubicOut)
            .call(zoomBehaviorRef.current.transform as any, d3.zoomIdentity);
        } else {
          zoomBehaviorRef.current.transform(d3.select(svgRef.current) as any, d3.zoomIdentity);
        }
        currentZoomTransformRef.current = d3.zoomIdentity;
      }

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
      }, 350);

      const performanceThreshold = configSettingsRef.current?.graph?.performanceThreshold ?? 1200;
      const useTransition = nodes.length < performanceThreshold;

      // Animate nodes and links into orbit positions
      const tNode: any = useTransition
        ? (nodeSelectionRef.current as any).transition('layout').duration(450).ease(d3.easeCubicOut)
        : nodeSelectionRef.current;
      tNode.attr('transform', (d: any) => `translate(${d.x},${d.y})`);

      const tLink: any = useTransition
        ? (linkSelectionRef.current as any).transition('layout').duration(450).ease(d3.easeCubicOut)
        : linkSelectionRef.current;
      tLink
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

      {/* Floating Glassmorphic Query & Filter HUD (Top-Right) */}
      {isToolbarCollapsed ? (
        <button
          className="graph-floating-toggle-btn"
          onClick={toggleToolbarCollapse}
          title="Expand Filter Controls (/)"
        >
          <Search size={14} style={{ color: 'var(--accent-hover)' }} />
          <span>Search & Filters</span>
          {matchStats.isFiltering && (
            <span className="graph-collapsed-filter-dot" title={`${matchStats.matchCount} matched`}>
              {matchStats.hasNoMatches ? '0' : matchStats.matchCount}
            </span>
          )}
          <ChevronDown size={13} style={{ opacity: 0.7 }} />
        </button>
      ) : (
        <div className="graph-floating-toolbar">
          {/* Top Row: Search + Match Stats + Reset + Collapse */}
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
                  `${matchStats.matchCount} matched`
                )}
              </div>
            )}

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

          {/* Focus Anchor Badge (When right-clicked / pinned or in orbit mode) */}
          {focusAnchorId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
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
                  (Click node to re-center orbit)
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

          {/* Combined Scope Depth & Consolidated Nodes Pill Row */}
          <div className="graph-scope-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Layers size={13} style={{ color: 'var(--accent-hover)' }} />
                <span>Scope:</span>
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

            <button
              className={`graph-toggle-pill ${showConsolidated ? 'active' : ''}`}
              onClick={() => {
                const nextVal = !showConsolidated;
                setShowConsolidated(nextVal);
                localStorage.setItem('stormdrain_graph_show_consolidated', String(nextVal));
                if (activeTier1SetRef.current.size > 0 || debouncedQuery) {
                  setTimeout(() => applyActiveFilterStylingRef.current(), 0);
                }
              }}
              title={showConsolidated ? "Click to hide consolidated memory satellites" : "Click to show consolidated memory satellites"}
            >
              <Orbit size={13} style={{ color: showConsolidated ? 'var(--accent-hover)' : 'var(--text-muted)' }} />
              <span>Consolidated Nodes</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom-Right Layout & Physics Controls HUD */}
      <div className="graph-layout-hud">
        {/* Physics Tuning Panel Drawer (stacked above control row) */}
        {isPhysicsOpen && (
          <div className="graph-physics-panel" style={{ width: '420px', maxWidth: 'calc(100vw - 40px)' }}>
            <div className="graph-physics-header">
              <div className="graph-physics-title">
                <Sparkles size={13} style={{ color: 'var(--accent-color, #38bdf8)' }} />
                <span>Physics & Clustering Forces</span>
              </div>
              <div className="graph-physics-presets">
                {(['auto', 'strongly_clustered', 'clustered', 'standard', 'massive'] as const).map(preset => (
                  <button
                    key={preset}
                    className={`graph-preset-chip ${physics.activePreset === preset ? 'active' : ''}`}
                    onClick={() => applyPreset(preset)}
                  >
                    {preset.replace('_', ' ')}
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

              {/* Memory Repulsion (Separate from File Charge) */}
              <div className="graph-slider-item">
                <div className="graph-slider-label-row">
                  <span>Memory Repulsion</span>
                  <span className="graph-slider-val">{physics.memoryChargeStrength ?? -140}</span>
                </div>
                <input
                  type="range"
                  min="-400"
                  max="-10"
                  step="10"
                  value={physics.memoryChargeStrength ?? -140}
                  onChange={(e) => updatePhysics({ memoryChargeStrength: Number(e.target.value), activePreset: 'custom' })}
                />
              </div>

              {/* Inter-Module Tension Ratio */}
              <div className="graph-slider-item">
                <div className="graph-slider-label-row">
                  <span>Inter-Module Tension</span>
                  <span className="graph-slider-val">{((physics.interModuleTensionRatio ?? 0.25) * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="1.00"
                  step="0.05"
                  value={physics.interModuleTensionRatio ?? 0.25}
                  onChange={(e) => updatePhysics({ interModuleTensionRatio: Number(e.target.value), activePreset: 'custom' })}
                />
              </div>

              {/* Render Engine Segmented Selector */}
              <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px', borderTop: '1px solid rgba(148,163,184,0.15)', paddingTop: '8px' }}>
                <div className="graph-slider-label-row">
                  <span>Render Engine</span>
                  <span className="graph-slider-val" style={{ textTransform: 'uppercase' }}>{renderMode}</span>
                </div>
                <div className="graph-scope-segmented" style={{ width: '100%', boxSizing: 'border-box' }}>
                  <button
                    className={`graph-scope-btn ${renderMode === 'auto' ? 'active' : ''}`}
                    style={{ flex: 1 }}
                    onClick={() => setRenderMode('auto')}
                    title="Auto-switch to Canvas engine when graph exceeds 300 nodes"
                  >
                    Auto (Hybrid)
                  </button>
                  <button
                    className={`graph-scope-btn ${renderMode === 'canvas' ? 'active' : ''}`}
                    style={{ flex: 1 }}
                    onClick={() => setRenderMode('canvas')}
                    title="Force HTML5 2D Canvas engine (ultra high performance for 1000+ nodes)"
                  >
                    Canvas
                  </button>
                  <button
                    className={`graph-scope-btn ${renderMode === 'svg' ? 'active' : ''}`}
                    style={{ flex: 1 }}
                    onClick={() => setRenderMode('svg')}
                    title="Force SVG DOM engine (vector graphics for small graphs)"
                  >
                    SVG
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Labels Display Settings Drawer (stacked above control row) */}
        {isLabelsOpen && (
          <div className="graph-physics-panel" style={{ width: '320px', maxWidth: 'calc(100vw - 40px)' }}>
            <div className="graph-physics-header" style={{ marginBottom: '12px' }}>
              <div className="graph-physics-title">
                <Type size={13} style={{ color: 'var(--accent-color, #38bdf8)' }} />
                <span>Label Configuration</span>
              </div>
            </div>

            <div className="graph-physics-sliders-grid" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Label Mode */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Display Mode</span>
                <select
                  value={labelSettings.mode}
                  onChange={(e) => updateLabelSettings({ mode: e.target.value as any })}
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                    borderRadius: '6px',
                    color: 'var(--text-main)',
                    padding: '6px 8px',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    outline: 'none',
                    width: '100%'
                  }}
                >
                  <option value="all">Show All Labels</option>
                  <option value="dynamic">Dynamic (Landmarks + Hover)</option>
                  <option value="hover-only">Hover-Only Lens (No Landmarks)</option>
                </select>
              </div>

              {/* Label Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Filter Scope</span>
                <select
                  value={labelSettings.filter}
                  onChange={(e) => updateLabelSettings({ filter: e.target.value as any })}
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                    borderRadius: '6px',
                    color: 'var(--text-main)',
                    padding: '6px 8px',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    outline: 'none',
                    width: '100%'
                  }}
                >
                   <option value="all">Apply Mode to All Nodes</option>
                   <option value="always-show-memories">Always Show Memories (Dynamic Files)</option>
                </select>
              </div>

              {/* Text Backing Toggle */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Dark Text Backing (Halo)</span>
                <label className="switch" style={{ width: '44px', height: '24px' }}>
                  <input
                    type="checkbox"
                    checked={labelSettings.textBacking}
                    onChange={(e) => updateLabelSettings({ textBacking: e.target.checked })}
                  />
                  <span className="slider round"></span>
                </label>
              </div>

              {/* Focus Mode Toggle */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Focus Mode (Sub-graph Neighborhood)</span>
                <label className="switch" style={{ width: '44px', height: '24px' }}>
                  <input
                    type="checkbox"
                    checked={labelSettings.focusMode}
                    onChange={(e) => updateLabelSettings({ focusMode: e.target.checked })}
                  />
                  <span className="slider round"></span>
                </label>
              </div>
            </div>
          </div>
        )}

        <div className="graph-layout-control-row">
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
            onClick={() => {
              setIsPhysicsOpen(prev => !prev);
              setIsLabelsOpen(false);
            }}
            title="Physics & Clustering Controls"
          >
            <SlidersHorizontal size={13} />
            <span>Physics</span>
            <span className="graph-preset-indicator">{physics.activePreset}</span>
          </button>

          {/* Labels Settings Toggle */}
          <button
            className={`graph-hud-icon-btn ${isLabelsOpen ? 'active' : ''}`}
            onClick={() => {
              setIsLabelsOpen(prev => !prev);
              setIsPhysicsOpen(false);
            }}
            title="Label Display & Readability Settings"
          >
            <Type size={13} />
            <span>Labels</span>
            <span className="graph-preset-indicator">{labelSettings.mode}</span>
          </button>
        </div>
      </div>

      {/* Main D3 Graph Canvas & SVG Overlay */}
      <canvas
        ref={canvasRef}
        className="graph-canvas-layer"
        style={{
          width: '100%',
          height: '100%',
          display: isCanvasMode ? 'block' : 'none'
        }}
        onClick={(e) => {
          if (!isCanvasMode) return;
          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) return;
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const transform = currentZoomTransformRef.current || d3.zoomIdentity;
          const [gx, gy] = transform.invert([mx, my]);
          const clicked = quadtreeRef.current?.find(gx, gy, 18);
          if (clicked) {
            if (layoutModeRef.current === 'orbit') {
              setFocusAnchorId(clicked.id);
              setFocusAnchorTitle(clicked.title);
            } else if (!clicked.id.startsWith('file_')) {
              setEditingId(clicked.id);
            }
          }
        }}
      />
      <svg
        ref={svgRef}
        className="graph-svg"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          pointerEvents: isCanvasMode ? 'none' : 'auto'
        }}
      ></svg>
      
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
