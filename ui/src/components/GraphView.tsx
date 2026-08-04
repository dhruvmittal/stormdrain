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
      const data = await api.getGraph(activeContext);
      
      const width = svgRef.current?.clientWidth || 800;
      const height = svgRef.current?.clientHeight || 600;

      // Clear previous
      d3.select(svgRef.current).selectAll('*').remove();

      const svg = d3.select(svgRef.current)
        .attr('viewBox', [0, 0, width, height]);

      const simulation = d3.forceSimulation(data.nodes as any)
        .force('link', d3.forceLink(data.links).id((d: any) => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2));

      const link = svg.append('g')
        .attr('stroke', 'var(--border-color)')
        .attr('stroke-opacity', 0.6)
        .selectAll('line')
        .data(data.links)
        .join('line')
        .attr('stroke-width', 2);

      const getTypeColor = (type: string) => {
        const colors: Record<string, string> = {
          fact: 'var(--color-fact)',
          lesson: 'var(--color-lesson)',
          pattern: 'var(--color-pattern)',
          warning: 'var(--color-warning)',
          guide: 'var(--color-guide)',
        };
        return colors[type] || 'var(--text-muted)';
      };

      const node = svg.append('g')
        .selectAll('g')
        .data(data.nodes as any)
        .join('g')
        .call(d3.drag()
          .on('start', dragstarted)
          .on('drag', dragged)
          .on('end', dragended) as any);

      node.append('circle')
        .attr('r', (d: any) => 8 + (d.confidence * 8))
        .attr('fill', (d: any) => getTypeColor(d.type))
        .attr('stroke', 'var(--bg-color)')
        .attr('stroke-width', 2);

      node.append('text')
        .text((d: any) => d.title)
        .attr('x', 15)
        .attr('y', 5)
        .attr('fill', 'var(--text-main)')
        .style('font-size', '12px')
        .style('pointer-events', 'none');

      node.on('click', (_event: any, d: any) => {
        setEditingId(d.id);
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
    <div className="graph-container">
      <div className="page-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(10px)', padding: '20px 30px' }}>
        <h2>Graph View</h2>
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
