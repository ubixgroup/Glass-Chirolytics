import React, { useContext, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import sankeyData from '@/assets/sankey/sankey.json';
import { InteractionEvent } from '@/types/interactionTypes';
import { GetCurrentTransformFn } from '@/utils/interactionHandlers';
import * as Y from 'yjs';
import { YjsContext } from '@/context/YjsContext';

// define types for our sankey data
interface Node {
  name: string;
  index?: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  value?: number;
  depth?: number;
  height?: number;
  layer?: number;
}

interface Link {
  source: number | Node;
  target: number | Node;
  value: number;
  id: string;
  pathId: string;
  sequenceNum: number;
  width?: number;
}

// removed unused extended interface

// helper function to process data for d3-sankey
const processData = (data: typeof sankeyData) => {
  // get unique nodes with their positions in the flow
  const nodeSet = new Set<string>();
  const nodePositions = new Map<string, number>();

  // first pass to collect nodes and their positions
  data.links.forEach(({ from, to }) => {
    if (!nodeSet.has(from)) {
      nodeSet.add(from);
      nodePositions.set(from, nodePositions.size);
    }
    if (!nodeSet.has(to)) {
      nodeSet.add(to);
      nodePositions.set(to, nodePositions.size);
    }
  });

  // create nodes array preserving order
  const nodes: Node[] = Array.from(nodeSet).map((name) => ({
    name,
    x0: 0,
    x1: 0,
    y0: 0,
    y1: 0,
  }));

  // create links array with original IDs
  const links: Link[] = data.links.map(({ from, to, value, id }) => ({
    source: nodePositions.get(from)!,
    target: nodePositions.get(to)!,
    value,
    id,
    pathId: id.split('-')[0],
    sequenceNum: parseInt(id.split('-')[1]),
  }));

  return { nodes, links };
};

interface SankeyProps {
  getCurrentTransformRef: React.MutableRefObject<GetCurrentTransformFn | null>;
}

const Sankey: React.FC<SankeyProps> = ({ getCurrentTransformRef }) => {
  // yjs context
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;

  // refs for svg and group elements
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);

  // dimensions
  const width = 1280;
  const height = 720;
  const margin = { top: 20, right: 20, bottom: 20, left: 20 };

  // track current transform state
  const currentTransform = useRef({ scale: 1, x: 0, y: 0 });

  // collaborative shared state (zoom/pan)
  const [syncStatus, setSyncStatus] = useState<boolean>(false);
  const ySharedStateRef = useRef<Y.Map<
    string | number | string[] | null
  > | null>(null);

  // add ref for tracking hover states for each hand
  const neutralHoverRef = useRef<{
    [key: string]: (SVGPathElement | SVGRectElement) | null;
  }>({
    left: null,
    right: null,
  });

  // add ref for tracking hovered node data
  const hoveredNodesRef = useRef<{
    [key: string]: Node | null;
  }>({
    left: null,
    right: null,
  });

  useEffect(() => {
    // expose current transform to the interaction system (fist gesture)
    getCurrentTransformRef.current = () => ({
      scale: currentTransform.current.scale,
      x: currentTransform.current.x,
      y: currentTransform.current.y,
    });

    return () => {
      getCurrentTransformRef.current = null;
    };
  }, [getCurrentTransformRef]);

  // simple sync ready flag (mirror movies behavior)
  useEffect(() => {
    if (!doc) return;
    const timeout = setTimeout(() => {
      console.log('assuming sync after timeout for sankey visualization');
      setSyncStatus(true);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [doc]);

  // initialize yjs shared state and observe remote transform changes
  useEffect(() => {
    if (!doc || !syncStatus) return;

    const yShared = doc.getMap<string | number | string[] | null>(
      'sankeySharedState'
    );
    ySharedStateRef.current = yShared;

    if (yShared.get('zoomScale') === undefined) {
      doc.transact(() => {
        yShared.set('zoomScale', 1);
        yShared.set('panX', 0);
        yShared.set('panY', 0);
        // initialize shared hover state so that hover highlights can sync across clients
        yShared.set('hoveredNodeNames', []);
        yShared.set('hoveredPathId', null);
      });
    }

    // apply initial
    const initScale = (yShared.get('zoomScale') as number) || 1;
    const initX = (yShared.get('panX') as number) || 0;
    const initY = (yShared.get('panY') as number) || 0;
    currentTransform.current = { scale: initScale, x: initX, y: initY };
    const root = d3.select('#sankey-root');
    if (!root.empty()) {
      root.attr(
        'transform',
        `translate(${initX},${initY}) scale(${initScale})`
      );
    }

    const observer = () => {
      const scale = (yShared.get('zoomScale') as number) || 1;
      const x = (yShared.get('panX') as number) || 0;
      const y = (yShared.get('panY') as number) || 0;
      if (
        scale !== currentTransform.current.scale ||
        x !== currentTransform.current.x ||
        y !== currentTransform.current.y
      ) {
        currentTransform.current = { scale, x, y };
        const r = d3.select('#sankey-root');
        if (!r.empty())
          r.attr('transform', `translate(${x},${y}) scale(${scale})`);
      }
    };

    yShared.observe(observer);
    return () => yShared.unobserve(observer);
  }, [doc, syncStatus]);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;

    // clear previous content
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // create main group
    const g = svg.append('g').attr('class', 'root').attr('id', 'sankey-root');

    // create defs container for gradients and filters
    const defs = svg.append('defs');

    // add a subtle drop shadow filter for nodes
    const shadowFilter = defs
      .append('filter')
      .attr('id', 'sankey-drop-shadow')
      .attr('height', '130%');
    shadowFilter
      .append('feGaussianBlur')
      .attr('in', 'SourceAlpha')
      .attr('stdDeviation', 2)
      .attr('result', 'blur');
    shadowFilter
      .append('feOffset')
      .attr('in', 'blur')
      .attr('dx', 1.5)
      .attr('dy', 1.5)
      .attr('result', 'offsetBlur');
    const feMerge = shadowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'offsetBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // add a lighter drop shadow filter specifically for text labels
    const textShadow = defs
      .append('filter')
      .attr('id', 'sankey-text-shadow')
      .attr('height', '120%');
    textShadow
      .append('feGaussianBlur')
      .attr('in', 'SourceAlpha')
      .attr('stdDeviation', 0.6)
      .attr('result', 'text-blur');
    textShadow
      .append('feOffset')
      .attr('in', 'text-blur')
      .attr('dx', 0.6)
      .attr('dy', 0.6)
      .attr('result', 'text-offset');
    // reduce alpha so the shadow is subtle
    textShadow
      .append('feComponentTransfer')
      .append('feFuncA')
      .attr('type', 'linear')
      .attr('slope', 0.4);
    const textMerge = textShadow.append('feMerge');
    textMerge.append('feMergeNode').attr('in', 'text-offset');
    textMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // process data for d3-sankey
    const { nodes, links } = processData(sankeyData);

    // create sankey generator
    const sankeyGenerator = sankey<Node, Link>()
      .nodeWidth(100)
      .nodePadding(30)
      .extent([
        [margin.left, margin.top],
        [width - margin.right, height - margin.bottom],
      ]);

    // generate layout
    const { nodes: sankeyNodes, links: sankeyLinks } = sankeyGenerator({
      nodes: nodes.map((d) => ({ ...d })),
      links: links.map((d) => ({ ...d })),
    });

    // create color scale per node name so coloring is stable and not path-dependent
    const nodeColorScale = d3
      .scaleOrdinal<string, string>(d3.schemeCategory10)
      .domain((sankeyNodes as Node[]).map((n) => n.name));

    // draw links grouped by pathId
    const linkGroups = d3.group(sankeyLinks, (d) => d.pathId);

    // create a map of path elements for hover behavior
    const pathElements = new Map<string, SVGPathElement[]>();
    // create a map of node name to rect element for quick highlighting
    const nodeElements = new Map<string, SVGRectElement>();

    // helpers for node highlight styles
    const applyNodeHighlight = (rect: SVGRectElement) => {
      d3.select(rect).attr('stroke', '#ECC94B').attr('stroke-width', 3);
    };
    const removeNodeHighlight = (rect: SVGRectElement) => {
      d3.select(rect).attr('stroke', '#1A202C').attr('stroke-width', 2);
    };

    // helper to get node color (stable per node)
    const getNodeColor = (node: Node) => nodeColorScale(node.name) as string;

    // create per-link gradients (source color to target color)
    sankeyLinks.forEach((lnk) => {
      if (typeof lnk.source !== 'object' || typeof lnk.target !== 'object') {
        return;
      }
      const sourceNode = lnk.source as Node;
      const targetNode = lnk.target as Node;
      const gradId = `sankey-grad-${lnk.pathId}-${lnk.sequenceNum}`;

      const gradient = defs
        .append('linearGradient')
        .attr('id', gradId)
        .attr('gradientUnits', 'userSpaceOnUse')
        .attr('x1', sourceNode.x1)
        .attr('y1', (sourceNode.y0 + sourceNode.y1) / 2)
        .attr('x2', targetNode.x0)
        .attr('y2', (targetNode.y0 + targetNode.y1) / 2);

      gradient
        .append('stop')
        .attr('offset', '0%')
        .attr('stop-color', getNodeColor(sourceNode))
        .attr('stop-opacity', 0.9);
      gradient
        .append('stop')
        .attr('offset', '100%')
        .attr('stop-color', getNodeColor(targetNode))
        .attr('stop-opacity', 0.9);
    });

    linkGroups.forEach((pathLinks, pathId) => {
      // sort links by sequence number
      pathLinks.sort((a, b) => a.sequenceNum - b.sequenceNum);

      const pathGroup = g
        .append('g')
        .attr('class', `path-group-${pathId}`)
        .selectAll('path')
        .data(pathLinks)
        .join('path')
        .attr('d', sankeyLinkHorizontal())
        .attr('fill', 'none')
        .attr('stroke', (d) => `url(#sankey-grad-${d.pathId}-${d.sequenceNum})`)
        .attr('stroke-width', (d) => Math.max(1, d.width || 0))
        .attr('stroke-opacity', 0.45)
        .attr('data-path-id', pathId)
        .attr('data-sequence', (d) => d.sequenceNum)
        .attr('class', 'interactable')
        .style('mix-blend-mode', 'multiply')
        .style('cursor', 'pointer');

      // store path elements for interaction handling
      pathElements.set(
        pathId,
        pathGroup.nodes().filter((n): n is SVGPathElement => n !== null)
      );
    });

    // draw nodes
    const nodeSelection = g
      .append('g')
      .selectAll('rect')
      .data(sankeyNodes)
      .join('rect')
      .attr('x', (d: Node) => d.x0)
      .attr('y', (d: Node) => d.y0)
      .attr('height', (d: Node) => Math.max(0, d.y1 - d.y0))
      .attr('width', (d: Node) => Math.max(0, d.x1 - d.x0))
      .attr('fill', (d: Node) => getNodeColor(d))
      .attr('rx', 4)
      .attr('ry', 4)
      .attr('stroke', '#1A202C')
      .attr('stroke-width', 2)
      .attr('opacity', 0.8)
      .attr('class', 'interactable')
      .attr('data-node-name', (d: Node) => d.name)
      .style('cursor', 'pointer')
      .style('filter', 'url(#sankey-drop-shadow)');

    // populate nodeElements map for quick lookup by name
    nodeSelection.each(function (d: Node) {
      nodeElements.set(d.name, this as SVGRectElement);
    });

    // add node labels
    g.append('g')
      .selectAll('text')
      .data(sankeyNodes)
      .join('text')
      .attr('x', (d) => (d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6))
      .attr('y', (d) => (d.y1 + d.y0) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d) => (d.x0 < width / 2 ? 'start' : 'end'))
      .text((d) => d.name)
      .style('font-size', '30px')
      .style('fill', '#333')
      // apply a lighter drop shadow to improve label legibility without overwhelming
      .style('filter', 'url(#sankey-text-shadow)');

    // helper to find paths between two nodes
    const findPathsBetweenNodes = (node1: Node, node2: Node) => {
      // group links by pathId for easier sequence checking
      const linksByPath = d3.group(sankeyLinks, (d) => d.pathId);
      const validPaths = new Set<string>();

      // check each path
      linksByPath.forEach((pathLinks, pathId) => {
        // sort links by sequence number to get flow order
        pathLinks.sort((a, b) => a.sequenceNum - b.sequenceNum);

        // convert to array of node names in sequence
        const nodeSequence = pathLinks.map((link) => {
          const source =
            typeof link.source === 'object' ? link.source.name : null;
          const target =
            typeof link.target === 'object' ? link.target.name : null;
          return { source, target };
        });

        // check if both nodes appear anywhere in the path (directionless)
        let node1Index = -1;
        let node2Index = -1;

        for (let i = 0; i < nodeSequence.length; i++) {
          const { source, target } = nodeSequence[i];
          if (source === node1.name) node1Index = i;
          if (source === node2.name) node2Index = i;
          if (target === node1.name) node1Index = i + 1;
          if (target === node2.name) node2Index = i + 1;
        }

        // if both nodes appear in the path, treat as valid regardless of order
        if (node1Index !== -1 && node2Index !== -1) {
          validPaths.add(pathId);
        }
      });

      // return links that are part of valid paths
      return sankeyLinks.filter((link) => validPaths.has(link.pathId));
    };

    // helper to reset all path highlights
    const resetAllPathHighlights = () => {
      sankeyLinks.forEach((link) => {
        const pathLinks = pathElements.get(link.pathId);
        if (pathLinks) {
          pathLinks.forEach((pathLink: SVGPathElement) => {
            const linkData = d3.select(pathLink).datum() as Link;
            d3.select(pathLink)
              .attr('stroke-opacity', 0.45)
              .attr('stroke-width', Math.max(1, linkData.width || 0));
          });
        }
      });
    };

    // helper to reset all node highlights
    const resetAllNodeHighlights = () => {
      nodeElements.forEach((rect) => {
        removeNodeHighlight(rect);
      });
    };

    // helper to highlight an entire path group by id
    const highlightPathGroup = (pathId: string) => {
      const groupLinks = pathElements.get(pathId);
      if (groupLinks) {
        groupLinks.forEach((linkEl: SVGPathElement) => {
          const linkData = d3.select(linkEl).datum() as Link;
          const baseWidth = Math.max(1, linkData.width || 0);
          d3.select(linkEl)
            .attr('stroke-opacity', 0.95)
            .attr('stroke-width', baseWidth + 2);
        });
      }
    };

    // apply highlights based on shared yjs hover state
    const applyHighlightsFromSharedState = () => {
      resetAllPathHighlights();
      resetAllNodeHighlights();

      const yShared = ySharedStateRef.current;
      if (!yShared) return;

      const hoveredNodeNames =
        (yShared.get('hoveredNodeNames') as string[]) || [];
      const hoveredPathId =
        (yShared.get('hoveredPathId') as string | null) || null;

      // prioritize node pair highlighting; then single node; then path hover
      if (hoveredNodeNames.length >= 2) {
        const [firstName, secondName] = hoveredNodeNames;
        const nodeA = (sankeyNodes as Node[]).find((n) => n.name === firstName);
        const nodeB = (sankeyNodes as Node[]).find(
          (n) => n.name === secondName
        );
        if (nodeA && nodeB) {
          const rectA = nodeElements.get(firstName);
          const rectB = nodeElements.get(secondName);
          if (rectA) applyNodeHighlight(rectA);
          if (rectB) applyNodeHighlight(rectB);

          const between = findPathsBetweenNodes(nodeA, nodeB);
          between.forEach((lnk) => highlightPathGroup(lnk.pathId));
        }
        return;
      }

      if (hoveredNodeNames.length === 1) {
        const name = hoveredNodeNames[0];
        const rect = nodeElements.get(name);
        if (rect) applyNodeHighlight(rect);
        const connectedPaths = new Set(
          sankeyLinks
            .filter(
              (l) =>
                (typeof l.source === 'object' && l.source.name === name) ||
                (typeof l.target === 'object' && l.target.name === name)
            )
            .map((l) => l.pathId)
        );
        connectedPaths.forEach((pid) => highlightPathGroup(pid));
        return;
      }

      if (hoveredPathId) {
        highlightPathGroup(hoveredPathId);
      }
    };

    // handle interaction events
    const handleInteraction = (event: Event) => {
      const customEvent = event as CustomEvent<InteractionEvent>;
      const { type } = customEvent.detail;

      if (type === 'pointerover') {
        const { handedness, element } = customEvent.detail;
        if (!handedness || !element) return;

        // store the newly hovered element for this hand
        neutralHoverRef.current[handedness] = element as
          | SVGPathElement
          | SVGRectElement;

        // if element is a link path and fewer than two nodes are hovered, update shared path hover
        if (element instanceof SVGPathElement) {
          const pathId = element.getAttribute('data-path-id');
          const yShared = ySharedStateRef.current;
          if (pathId && yShared && doc && syncStatus) {
            const hoveredNodeNames =
              (yShared.get('hoveredNodeNames') as string[]) || [];
            if (hoveredNodeNames.length < 2) {
              doc.transact(() => {
                yShared.set('hoveredPathId', pathId);
              });
            }
          } else if (!yShared) {
            // fallback: apply locally if yjs not available
            applyHighlightsFromSharedState();
          }
        }

        // if element is a node rect, update hovered node state and handle highlighting via yjs
        if (element instanceof SVGRectElement) {
          const nodeData = d3.select(element).datum() as Node;
          hoveredNodesRef.current[handedness] = nodeData;

          const yShared = ySharedStateRef.current;
          if (yShared && doc && syncStatus) {
            const current = (yShared.get('hoveredNodeNames') as string[]) || [];
            if (!current.includes(nodeData.name)) {
              doc.transact(() => {
                yShared.set('hoveredNodeNames', [...current, nodeData.name]);
                // when a node is hovered, clear any path-only hover to prioritize node logic
                yShared.set('hoveredPathId', null);
              });
            }
          } else if (!yShared) {
            applyHighlightsFromSharedState();
          }
        }
      } else if (type === 'pointerout') {
        const { handedness } = customEvent.detail;
        if (!handedness) return;

        const hoveredElement = neutralHoverRef.current[handedness];
        const otherHand = handedness === 'left' ? 'right' : 'left';
        const otherNodeData = hoveredNodesRef.current[otherHand];

        // clear current hand hover state
        hoveredNodesRef.current[handedness] = null;
        neutralHoverRef.current[handedness] = null;

        if (hoveredElement) {
          const yShared = ySharedStateRef.current;
          if (yShared && doc && syncStatus) {
            doc.transact(() => {
              if (hoveredElement instanceof SVGRectElement) {
                const nodeData = d3.select(hoveredElement).datum() as Node;
                const current =
                  (yShared.get('hoveredNodeNames') as string[]) || [];
                const updated = current.filter((n) => n !== nodeData.name);
                yShared.set('hoveredNodeNames', updated);
              } else if (hoveredElement instanceof SVGPathElement) {
                yShared.set('hoveredPathId', null);
              }
            });
          } else if (!yShared) {
            applyHighlightsFromSharedState();
          }
        }
      } else if (
        (type === 'zoom' || type === 'drag') &&
        'transform' in customEvent.detail
      ) {
        const { transform } = customEvent.detail;
        const { x, y } = transform;
        let scale = currentTransform.current.scale;
        if ('scale' in transform) {
          // the transform from zoom events includes scale; drag uses previous scale
          scale = (transform as { scale: number }).scale;
        }
        // publish to yjs if available, otherwise apply locally
        if (ySharedStateRef.current && doc && syncStatus) {
          doc.transact(() => {
            ySharedStateRef.current!.set('panX', x);
            ySharedStateRef.current!.set('panY', y);
            ySharedStateRef.current!.set('zoomScale', scale);
          });
        } else {
          g.attr('transform', `translate(${x},${y}) scale(${scale})`);
        }
        currentTransform.current = { scale, x, y };
      }
    };

    // add event listener
    const parent = svg.node()?.parentElement;
    if (parent) {
      parent.addEventListener(
        'interaction',
        handleInteraction as EventListener
      );
    }

    // observe shared hover state and apply highlights
    const sharedObserver = () => {
      applyHighlightsFromSharedState();
    };
    if (ySharedStateRef.current) {
      ySharedStateRef.current.observe(sharedObserver);
    }

    // initial apply to ensure consistent state
    applyHighlightsFromSharedState();

    // cleanup
    return () => {
      if (parent) {
        parent.removeEventListener(
          'interaction',
          handleInteraction as EventListener
        );
      }
      if (ySharedStateRef.current) {
        ySharedStateRef.current.unobserve(sharedObserver);
      }
    };
  }, [margin.top, margin.right, margin.bottom, margin.left, doc, syncStatus]);

  if (!syncStatus) {
    return (
      <div
        style={{
          width: width,
          height: height,
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'transparent',
          overflow: 'hidden',
          borderRadius: '8px',
          boxShadow: 'inset 0 0 10px rgba(0,0,0,0.05)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '2rem',
            maxWidth: '600px',
            background: 'rgba(255,255,255,0.8)',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            color: '#333',
          }}
        >
          <div
            style={{
              fontSize: '2rem',
              marginBottom: '0.5rem',
              fontWeight: 500,
              color: '#333',
            }}
          >
            sankey visualization
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              marginBottom: '1.5rem',
              color: '#555',
            }}
          >
            waiting for synchronization...
          </div>
          <div
            style={{
              marginTop: '1rem',
              width: '100%',
              height: '6px',
              background: '#eee',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '40%',
                height: '100%',
                background: `linear-gradient(to right, #2980b9, #2980b9)`,
                animation: 'progressAnimation 2s infinite',
                borderRadius: '8px',
              }}
            >
              <style>
                {`
                  @keyframes progressAnimation {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(250%); }
                  }
                `}
              </style>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className='interactable'
      style={{ borderRadius: '8px', background: 'transparent' }}
    >
      <g ref={gRef} />
    </svg>
  );
};

export default Sankey;
