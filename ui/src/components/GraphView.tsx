import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { api } from '../api';
import MemoryEditor from './MemoryEditor';

interface GraphViewProps {
  activeContext: string;
}

const GraphView: React.FC<GraphViewProps> = ({ activeContext }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    if (!activeContext || !svgRef.current) return;

    const renderGraph = async () => {
      const rawData = await api.getGraph(activeContext);
      if (!rawData || !rawData.nodes) return;
      
      const width = svgRef.current?.parentElement?.clientWidth || 900;
      const height = svgRef.current?.parentElement?.clientHeight || 700;

      // Filter valid links where both source & target exist in nodes
      const nodeIds = new Set((rawData.nodes || []).map((n: any) => n.id));
      const validLinks = (rawData.links || []).filter(
        (l: any) => nodeIds.has(l.source) && nodeIds.has(l.target)
      );

      // Deep copy nodes & links for D3 force mutation
      const nodes = (rawData.nodes || []).map((n: any) => ({ ...n }));
      const links = validLinks.map((l: any) => ({ ...l }));

      // Clear previous SVG content
      d3.select(svgRef.current).selectAll('*').remove();

      const svg = d3.select(svgRef.current)
        .attr('viewBox', [0, 0, width, height]);

      // Add Zoom Container
      const container = svg.append('g').attr('class', 'zoom-container');

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 5])
        .on('zoom', (event) => {
          container.attr('transform', event.transform);
        });

      svg.call(zoom as any);

      // Force Simulation
      const simulation = d3.forceSimulation(nodes as any)
        .force('link', d3.forceLink(links).id((d: any) => d.id).distance(120))
        .force('charge', d3.forceManyBody().strength(-350))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collide', d3.forceCollide(35));

      // Draw Links
      const link = container.append('g')
        .attr('stroke-opacity', 0.6)
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke', (d: any) => d.type === 'imports' ? '#38bdf8' : 'var(--border-color)')
        .attr('stroke-dasharray', (d: any) => d.type === 'imports' ? '4 2' : 'none')
        .attr('stroke-width', (d: any) => d.type === 'imports' ? 1.5 : 2);

      const getTypeColor = (type: string) => {
        const colors: Record<string, string> = {
          codemap: '#06b6d4',  // Cyan for file vertices
          fact: '#10b981',     // Green
          lesson: '#f59e0b',   // Amber
          pattern: '#8b5cf6',  // Purple
          warning: '#ef4444',  // Red
          guide: '#ec4899',    // Pink
        };
        return colors[type] || '#94a3b8';
      };

      // Draw Nodes
      const node = container.append('g')
        .selectAll('g')
        .data(nodes as any)
        .join('g')
        .call(d3.drag()
          .on('start', dragstarted)
          .on('drag', dragged)
          .on('end', dragended) as any);

      node.append('circle')
        .attr('r', (d: any) => d.type === 'codemap' ? 10 : 8 + ((d.confidence || 0.8) * 6))
        .attr('fill', (d: any) => getTypeColor(d.type))
        .attr('stroke', 'var(--bg-color)')
        .attr('stroke-width', 2);

      node.append('text')
        .text((d: any) => d.title)
        .attr('x', 14)
        .attr('y', 4)
        .attr('fill', (d: any) => d.type === 'codemap' ? '#38bdf8' : 'var(--text-main)')
        .style('font-size', (d: any) => d.type === 'codemap' ? '11px' : '12px')
        .style('font-weight', (d: any) => d.type === 'codemap' ? '600' : '400')
        .style('pointer-events', 'none');

      node.on('click', (_event: any, d: any) => {
        if (!d.id.startsWith('file_')) {
          setEditingId(d.id);
        }
      });
      node.style('cursor', 'pointer');

      simulation.on('tick', () => {
        link
          .attr('x1', (d: any) => d.source.x)
          .attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x)
          .attr('y2', (d: any) => d.target.y);

        node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
      });

      function dragstarted(event: any, d: any) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      }
      
      function dragged(event: any, d: any) {
        d.fx = event.x;
        d.fy = event.y;
      }
      
      function dragended(event: any, d: any) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }
    };

    renderGraph();
  }, [activeContext, dataVersion]);

  return (
    <div className="graph-container" style={{ width: '100%', height: 'calc(100vh - 40px)', position: 'relative' }}>
      <div className="page-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(10px)', padding: '15px 30px' }}>
        <h2>Graph View ({activeContext})</h2>
      </div>
      <svg ref={svgRef} className="graph-svg" style={{ width: '100%', height: '100%', display: 'block' }}></svg>
      
      {editingId && (
        <MemoryEditor
          activeContext={activeContext}
          memoryId={editingId}
          onClose={() => setEditingId(null)}
          onSave={() => {
            setEditingId(null);
            setDataVersion(v => v + 1);
          }}
        />
      )}
    </div>
  );
};

export default GraphView;
