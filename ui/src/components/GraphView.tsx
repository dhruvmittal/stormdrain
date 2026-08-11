import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { api } from '../api';
import MemoryEditor from './MemoryEditor';
import { Search, X, Crosshair, Layers } from 'lucide-react';


interface GraphViewProps {
  activeContext: string;
  dataVersion?: number;
}

type ScopeDepth = 0 | 1 | 2;

const MEMORY_TYPES = ['all', 'concept', 'pattern', 'guide', 'lesson', 'fact', 'warning', 'codemap', 'sequence'] as const;

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
  const positionsCacheRef = useRef<Map<string, { x: number; y: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null }>>(new Map());
  const currentZoomTransformRef = useRef<d3.ZoomTransform | null>(null);
  const previousContextRef = useRef<string | null>(null);
  const isInitializedRef = useRef<boolean>(false);

  // UI & Filter state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState(0);
  const effectiveVersion = dataVersion + localVersion;
  const [searchQuery, setSearchQuery] = useState('');

  const [debouncedQuery, setDebouncedQuery] = useState('');
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

  // 300ms Search Debounce
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Global Keyboard Shortcuts (/ to search, Esc to clear)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        if (searchQuery || selectedType !== 'all' || focusAnchorId) {
          setSearchQuery('');
          setDebouncedQuery('');
          setSelectedType('all');
          setFocusAnchorId(null);
          setFocusAnchorTitle(null);
          searchInputRef.current?.blur();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, selectedType, focusAnchorId]);

  const getTypeColor = useCallback((type: string) => {
    const colors: Record<string, string> = {
      concept: '#38bdf8',  // Sky Blue / Electric Blue
      codemap: '#06b6d4',  // Cyan for file vertices
      fact: '#10b981',     // Green
      lesson: '#f59e0b',   // Amber
      pattern: '#8b5cf6',  // Purple
      warning: '#ef4444',  // Red
      guide: '#ec4899',    // Pink
      sequence: '#6366f1'  // Indigo
    };
    return colors[type] || '#94a3b8';
  }, []);

  // Multi-Hop Visual Filter & Spotlight Overlay (Non-Destructive Styling)
  const applyActiveFilterStyling = useCallback(() => {
    if (!nodeSelectionRef.current || !linkSelectionRef.current) return;

    const { nodes } = rawGraphDataRef.current;
    if (!nodes || nodes.length === 0) return;

    const query = debouncedQuery.trim().toLowerCase();
    const isFiltering = Boolean(query || selectedType !== 'all' || focusAnchorId);

    // Compute Tier 1 (Match Set)
    const tier1Set = new Set<string>();
    
    if (focusAnchorId) {
      tier1Set.add(focusAnchorId);
    } else if (isFiltering) {
      for (const n of nodes) {
        const matchesType = selectedType === 'all' || n.type === selectedType;
        const matchesQuery = !query || 
          n.title?.toLowerCase().includes(query) || 
          n.content?.toLowerCase().includes(query) ||
          n.id?.toLowerCase().includes(query);

        if (matchesType && matchesQuery) {
          tier1Set.add(n.id);
        }
      }
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

    setMatchStats({
      matchCount: tier1Set.size,
      inScopeCount: inScopeSet.size,
      totalCount: nodes.length,
      isFiltering,
      hasNoMatches,
    });

    // Interrupt any ongoing transitions
    nodeSelectionRef.current.interrupt();
    linkSelectionRef.current.interrupt();

    // If not filtering OR if 0 matches, show full baseline graph
    if (!isFiltering || hasNoMatches) {
      nodeSelectionRef.current
        .transition()
        .duration(200)
        .style('opacity', 1.0)
        .style('filter', 'none');

      nodeSelectionRef.current.select('.node-circle')
        .transition()
        .duration(200)
        .attr('r', (d: any) => d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6))
        .attr('stroke', 'var(--bg-color)')
        .attr('stroke-width', 2);

      nodeSelectionRef.current.select('.node-label')
        .transition()
        .duration(200)
        .style('opacity', 1.0)
        .style('font-weight', (d: any) => d.type === 'codemap' ? '600' : '400');

      linkSelectionRef.current
        .transition()
        .duration(200)
        .attr('stroke-opacity', 0.6)
        .attr('stroke-width', (d: any) => d.type === 'imports' ? 1.5 : 2);

      return;
    }

    // Apply 4-Tier Visual Hierarchy
    nodeSelectionRef.current
      .transition()
      .duration(220)
      .style('opacity', (d: any) => {
        if (tier1Set.has(d.id)) return 1.0;
        if (tier2Set.has(d.id)) return 0.75;
        if (tier3Set.has(d.id)) return 0.50;
        return 0.25; // Tier 4: Ambient
      })
      .style('filter', (d: any) => {
        if (tier1Set.has(d.id) || tier2Set.has(d.id) || tier3Set.has(d.id)) return 'none';
        return 'grayscale(0.6)';
      });

    nodeSelectionRef.current.select('.node-circle')
      .transition()
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
      .transition()
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
      .transition()
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

      // Ensure persistent g groups for links and nodes
      let linkGroup = container.select<SVGGElement>('g.graph-links');
      if (linkGroup.empty()) {
        linkGroup = container.append('g').attr('class', 'graph-links');
      }

      let nodeGroup = container.select<SVGGElement>('g.graph-nodes');
      if (nodeGroup.empty()) {
        nodeGroup = container.append('g').attr('class', 'graph-nodes');
      }

      // Initialize or update D3 Force Simulation with Barnes-Hut & fast equilibrium tuning
      let simulation = simulationRef.current;
      const isFirstLoad = !isInitializedRef.current || !simulation;

      if (!simulation) {
        simulation = d3.forceSimulation()
          .force('link', d3.forceLink().id((d: any) => d.id).distance(120))
          .force('charge', d3.forceManyBody().strength(-320).theta(0.85).distanceMax(350))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collide', d3.forceCollide(38))
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
            .attr('stroke', (d: any) => d.type === 'imports' ? '#38bdf8' : 'var(--border-color)')
            .attr('stroke-dasharray', (d: any) => d.type === 'imports' ? '4 2' : 'none')
            .attr('stroke-width', (d: any) => d.type === 'imports' ? 1.5 : 2)
            .attr('stroke-opacity', 0.6),
          update => update,
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
              .attr('fill', (d: any) => d.type === 'codemap' ? '#38bdf8' : 'var(--text-main)')
              .style('font-size', (d: any) => d.type === 'codemap' ? '11px' : '12px')
              .style('font-weight', (d: any) => d.type === 'codemap' ? '600' : '400')
              .style('pointer-events', 'none');

            // Click: Open Memory Editor (for non-codemaps)
            g.on('click', (_event: any, d: any) => {
              if (!d.id.startsWith('file_')) {
                setEditingId(d.id);
              }
            });

            // ContextMenu / Right-click: Focus from here
            g.on('contextmenu', (event: any, d: any) => {
              event.preventDefault();
              setFocusAnchorId(prev => (prev === d.id ? null : d.id));
              setFocusAnchorTitle(prev => (prev === d.title ? null : d.title));
            });

            // Hover: Light up incident edges and direct neighbors
            g.on('mouseenter', (_event: any, d: any) => {
              const neighbors = adjacencyRef.current.get(d.id) || new Set();
              
              if (linkSelectionRef.current) {
                linkSelectionRef.current
                  .transition()
                  .duration(120)
                  .attr('stroke-opacity', (l: any) => {
                    const srcId = typeof l.source === 'object' ? l.source.id : l.source;
                    const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
                    return (srcId === d.id || tgtId === d.id) ? 1.0 : 0.08;
                  })
                  .attr('stroke-width', (l: any) => {
                    const srcId = typeof l.source === 'object' ? l.source.id : l.source;
                    const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
                    return (srcId === d.id || tgtId === d.id) ? 2.5 : 0.8;
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
              applyActiveFilterStyling();
            });

            return g;
          },
          update => {
            update.select('.node-circle')
              .attr('r', (d: any) => d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6))
              .attr('fill', (d: any) => getTypeColor(d.type));

            update.select('.node-label')
              .text((d: any) => d.title)
              .attr('fill', (d: any) => d.type === 'codemap' ? '#38bdf8' : 'var(--text-main)');

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
        if (!event.active) simulation!.alphaTarget(0.2).restart();
        d.fx = d.x;
        d.fy = d.y;
      }
      
      function dragged(event: any, d: any) {
        d.fx = event.x;
        d.fy = event.y;
      }
      
      function dragended(event: any, d: any) {
        if (!event.active) simulation!.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }

      // Initial filter styling pass
      applyActiveFilterStyling();
    };

    initGraph();

    return () => {
      isMounted = false;
    };
  }, [activeContext, effectiveVersion, getTypeColor, applyActiveFilterStyling]);


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
      <div className="graph-floating-toolbar">
        {/* Search Row */}
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

          {/* Reset button if active */}
          {(matchStats.isFiltering || focusAnchorId) && (
            <button
              onClick={clearAllFilters}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '5px 8px',
                fontSize: '0.72rem',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
              title="Reset all filters (Esc)"
            >
              <X size={12} /> Reset
            </button>
          )}
        </div>

        {/* Focus Anchor Badge (When right-clicked / pinned) */}
        {focusAnchorId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Focal Anchor:</span>
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
          </div>
        )}

        {/* Type Filter Pills */}
        <div className="graph-type-pills-row">
          {MEMORY_TYPES.map((type) => {
            const count = typeCounts[type] || 0;
            const isActive = selectedType === type;
            return (
              <button
                key={type}
                className={`graph-type-pill ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedType(type)}
              >
                <span style={{ textTransform: 'capitalize' }}>{type}</span>
                <span style={{ opacity: 0.7, fontSize: '0.68rem' }}>({count})</span>
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
