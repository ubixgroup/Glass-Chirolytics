import React, { useContext, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import * as Y from 'yjs';
import { YjsContext } from '@/context/YjsContext';
import { GetCurrentTransformFn } from '@/utils/interactionHandlers';
import { InteractionEvent, InteractionPoint } from '@/types/interactionTypes';

// define props for sysdes component
interface SysDesProps {
  getCurrentTransformRef: React.MutableRefObject<GetCurrentTransformFn | null>;
}

// constants for layout and styling to match the general style used by traveltask
const totalWidth = 1280;
const totalHeight = 720;
const panelWidth = totalWidth / 4;
const panelBackground = 'rgba(33, 33, 33, 0.2)';

// yjs value types for sysdes nodes
type SysDesNodeValue = string | number | boolean | undefined;
type SysDesLinkValue = string; // source/target ids stored as strings

// d3 node type for sysdes assets
interface SysDesD3Node extends d3.SimulationNodeDatum {
  id: string;
  type:
    | 'client'
    | 'load_balancer'
    | 'application_server'
    | 'database'
    | 'cache';
  name: string;
  uuid: string;
}

// link datum type for d3 rendering
type LinkDatum = { sourceId: string; targetId: string };

const SysDes: React.FC<SysDesProps> = ({ getCurrentTransformRef }) => {
  // refs for main container and panel svg
  const d3Container = useRef<HTMLDivElement | null>(null);
  const panelSvgRef = useRef<SVGSVGElement>(null);

  // yjs context
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;

  // shared collections in yjs
  const yNodes = doc?.getArray<Y.Map<SysDesNodeValue>>('sysdesNodes');
  const yLinks = doc?.getArray<Y.Map<SysDesLinkValue>>('sysdesLinks');
  const ySharedState = doc?.getMap<string | number>('sysdesSharedState');

  // transform ref for gestures
  const transformRef = useRef<{ k: number; x: number; y: number }>({
    k: 1,
    x: 0,
    y: 0,
  });

  // track drag state by hand for d3 nodes
  const dragStateRef = useRef<{
    left: {
      nodeMap: Y.Map<SysDesNodeValue> | null;
      offset: { x: number; y: number } | null;
    };
    right: {
      nodeMap: Y.Map<SysDesNodeValue> | null;
      offset: { x: number; y: number } | null;
    };
  }>({
    left: { nodeMap: null, offset: null },
    right: { nodeMap: null, offset: null },
  });

  // two-hand link dwell state
  // track two-hand dwell state for link toggling
  interface TwoHandLinkState {
    pairKey: string | null;
    startTime: number;
    toggled: boolean;
  }
  const twoHandLinkStateRef = useRef<TwoHandLinkState>({
    pairKey: null,
    startTime: 0,
    toggled: false,
  });

  // simple sync status like traveltask (timeout approach)
  const [syncStatus, setSyncStatus] = useState<boolean>(false);
  useEffect(() => {
    if (!doc) return;
    const timeout = setTimeout(() => setSyncStatus(true), 2000);
    return () => clearTimeout(timeout);
  }, [doc]);

  // expose current transform to outer interaction handlers
  useEffect(() => {
    getCurrentTransformRef.current = () => ({
      scale: transformRef.current.k,
      x: transformRef.current.x,
      y: transformRef.current.y,
    });
    return () => {
      getCurrentTransformRef.current = null;
    };
  }, [getCurrentTransformRef]);

  // sync transform from yjs shared state
  useEffect(() => {
    if (!doc || !ySharedState || !syncStatus) return;

    const initialTransform = {
      k: (ySharedState.get('zoomScale') as number) || 1,
      x: (ySharedState.get('panX') as number) || 0,
      y: (ySharedState.get('panY') as number) || 0,
    };
    transformRef.current = initialTransform;

    const observer = () => {
      const scale = (ySharedState.get('zoomScale') as number) || 1;
      const x = (ySharedState.get('panX') as number) || 0;
      const y = (ySharedState.get('panY') as number) || 0;
      if (
        scale !== transformRef.current.k ||
        x !== transformRef.current.x ||
        y !== transformRef.current.y
      ) {
        transformRef.current = { k: scale, x, y };
        const root = d3.select('#sysdes-root');
        if (!root.empty()) {
          root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
        }
      }
    };

    ySharedState.observe(observer);
    return () => ySharedState.unobserve(observer);
  }, [doc, ySharedState, syncStatus]);

  // initialize and update the d3 visualization
  useEffect(() => {
    if (!syncStatus || !doc || !yNodes || !ySharedState || !d3Container.current)
      return;

    // ensure shared transform defaults exist
    if (ySharedState.get('zoomScale') === undefined) {
      doc.transact(() => {
        ySharedState.set('zoomScale', 1);
        ySharedState.set('panX', 0);
        ySharedState.set('panY', 0);
      });
    }

    // clear any existing content
    d3.select(d3Container.current).selectAll('*').remove();

    // create svg
    const svg = d3
      .select(d3Container.current)
      .append('svg')
      .attr('width', totalWidth)
      .attr('height', totalHeight)
      .attr('class', 'interactable')
      .attr('viewBox', [0, 0, totalWidth, totalHeight])
      .attr('style', 'background: transparent; max-width: 100%; height: auto;');

    // svg defs for node drop shadow
    const defs = svg.append('defs');
    defs
      .append('filter')
      .attr('id', 'sysdes-drop-shadow')
      .attr('height', '130%')
      .append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 2)
      .attr('stdDeviation', 2)
      .attr('flood-opacity', 0.25);

    // apply initial transform
    const initialScale = (ySharedState.get('zoomScale') as number) || 1;
    const initialX = (ySharedState.get('panX') as number) || 0;
    const initialY = (ySharedState.get('panY') as number) || 0;
    transformRef.current = { k: initialScale, x: initialX, y: initialY };

    // transformed root group
    const root = svg
      .append('g')
      .attr('class', 'root')
      .attr('id', 'sysdes-root')
      .attr(
        'transform',
        `translate(${initialX}, ${initialY}) scale(${initialScale})`
      );

    // groups for links and nodes (links rendered behind nodes)
    const linkGroup = root.append('g').attr('class', 'links');
    const nodeGroup = root.append('g').attr('class', 'nodes');

    // helper: map yjs nodes to d3 nodes
    const mapNodesToD3 = (): SysDesD3Node[] => {
      const nodes: SysDesD3Node[] = [];
      for (let i = 0; i < yNodes.length; i++) {
        const m = yNodes.get(i);
        const id = (m.get('id') as string) || '';
        const type = (m.get('type') as SysDesD3Node['type']) || 'client';
        const name = (m.get('name') as string) || '';
        const x = (m.get('x') as number) ?? totalWidth / 2; // use nullish to allow 0
        const y = (m.get('y') as number) ?? totalHeight / 2; // use nullish to allow 0
        const uuid = (m.get('uuid') as string) || crypto.randomUUID();
        nodes.push({ id, type, name, x, y, uuid });
      }
      return nodes;
    };

    // drag handler reused for both existing and newly created nodes
    const handleNodeDrag = (
      point: InteractionPoint,
      handedness: 'left' | 'right',
      svgRect: DOMRect
    ) => {
      const dragState = dragStateRef.current[handedness];
      if (!dragState.nodeMap || !dragState.offset) return;

      const simulationX =
        (point.clientX - svgRect.left - transformRef.current.x) /
        transformRef.current.k;
      const simulationY =
        (point.clientY - svgRect.top - transformRef.current.y) /
        transformRef.current.k;

      const newX = simulationX + dragState.offset.x;
      const newY = simulationY + dragState.offset.y;

      doc.transact(() => {
        dragState.nodeMap?.set('x', newX);
        dragState.nodeMap?.set('y', newY);
      });

      updateVisualization();
    };

    // update visualization function
    const updateVisualization = () => {
      const nodes = mapNodesToD3();
      console.log('[SysDes] updateVisualization, node count =', nodes.length);

      // map for quick lookup
      const nodeById = new Map<string, SysDesD3Node>();
      nodes.forEach((n) => nodeById.set(n.id, n));

      // build links from yjs
      const links: LinkDatum[] = [];
      if (yLinks) {
        for (let i = 0; i < yLinks.length; i++) {
          const lm = yLinks.get(i);
          const s = (lm.get('source') as string) || '';
          const t = (lm.get('target') as string) || '';
          if (s && t) links.push({ sourceId: s, targetId: t });
        }
      }

      // render links
      const linkKey = (d: LinkDatum) =>
        [d.sourceId, d.targetId].sort().join('->');

      const linkSel = linkGroup
        .selectAll<SVGLineElement, LinkDatum>('line.link')
        .data(links, linkKey);

      linkSel.exit().remove();

      const linkEnter = linkSel.enter().append('line').attr('class', 'link');

      linkEnter
        .merge(linkSel)
        .attr('x1', (d) => nodeById.get(d.sourceId)?.x ?? 0)
        .attr('y1', (d) => nodeById.get(d.sourceId)?.y ?? 0)
        .attr('x2', (d) => nodeById.get(d.targetId)?.x ?? 0)
        .attr('y2', (d) => nodeById.get(d.targetId)?.y ?? 0)
        .attr('stroke', '#718096')
        .attr('stroke-width', 6)
        .attr('stroke-opacity', 0.9);

      const node = nodeGroup
        .selectAll<SVGGElement, SysDesD3Node>('g.node')
        .data(nodes, (d: SysDesD3Node) => d.uuid);

      node.exit().remove();

      const nodeEnter = node
        .enter()
        .append('g')
        .attr('class', 'node')
        .attr('data-id', (d) => d.id)
        .attr('data-uuid', (d) => d.uuid);

      // draw shapes per type with distinct silhouettes
      const base = nodeEnter
        .append('g')
        .attr('class', 'node-content')
        .style('filter', 'url(#sysdes-drop-shadow)');

      // client: circle
      base
        .filter((d) => d.type === 'client')
        .append('circle')
        .attr('class', 'node-shape interactable draggable')
        .attr('r', 32)
        .attr('fill', '#90cdf4')
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 2);

      // load balancer: diamond (rotated square)
      base
        .filter((d) => d.type === 'load_balancer')
        .append('polygon')
        .attr('class', 'node-shape interactable draggable')
        .attr('points', '0,-60 60,0 0,60 -60,0')
        .attr('fill', '#f6ad55')
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 2);

      // application server: rounded rectangle
      base
        .filter((d) => d.type === 'application_server')
        .append('rect')
        .attr('class', 'node-shape interactable draggable')
        .attr('x', -60)
        .attr('y', -30)
        .attr('rx', 10)
        .attr('ry', 10)
        .attr('width', 120)
        .attr('height', 60)
        .attr('fill', '#68d391')
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 2);

      // database: cylinder (body without stroke to avoid seams, plus top/bottom ellipses and side lines)
      const db = base.filter((d) => d.type === 'database').append('g');
      // body
      db.append('rect')
        .attr('class', 'node-shape interactable draggable')
        .attr('x', -50)
        .attr('y', -20)
        .attr('width', 100)
        .attr('height', 40)
        .attr('fill', '#f56565')
        .attr('stroke', 'none');
      // top cap
      db.append('ellipse')
        .attr('class', 'node-shape interactable draggable')
        .attr('cx', 0)
        .attr('cy', -20)
        .attr('rx', 50)
        .attr('ry', 16)
        .attr('fill', '#f56565')
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 2);
      // bottom cap
      db.append('ellipse')
        .attr('class', 'node-shape interactable draggable')
        .attr('cx', 0)
        .attr('cy', 20)
        .attr('rx', 50)
        .attr('ry', 16)
        .attr('fill', '#f56565')
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 2);
      // side strokes to complete outline
      db.append('line')
        .attr('x1', -50)
        .attr('y1', -20)
        .attr('x2', -50)
        .attr('y2', 20)
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 2)
        .attr('pointer-events', 'none');
      db.append('line')
        .attr('x1', 50)
        .attr('y1', -20)
        .attr('x2', 50)
        .attr('y2', 20)
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 2)
        .attr('pointer-events', 'none');

      // cache: hexagon
      base
        .filter((d) => d.type === 'cache')
        .append('polygon')
        .attr('class', 'node-shape interactable draggable')
        .attr('points', '-45,0 -22,-38 22,-38 45,0 22,38 -22,38')
        .attr('fill', '#b794f4')
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 2);

      base
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('y', (d: SysDesD3Node) => (d.type === 'database' ? -15 : 5))
        .attr('font-size', '14px')
        .attr('fill', '#1A202C')
        .text((d) => d.name);

      const nodeMerge = nodeEnter.merge(node);
      nodeMerge.attr(
        'transform',
        (d: SysDesD3Node) => `translate(${d.x || 0},${d.y || 0})`
      );
    };

    // interaction handler (receives custom events dispatched by display)
    // type guard to safely read an element from an interaction event
    type HasElement = { element?: Element };
    function hasElement(obj: unknown): obj is HasElement {
      return typeof obj === 'object' && obj !== null && 'element' in obj;
    }

    const handleInteraction = (event: InteractionEvent) => {
      if (event.type !== 'pointermove') {
        const el = hasElement(event) ? event.element : undefined;
        const tag = el?.tagName;
        const cls = el?.getAttribute('class') ?? undefined;
        console.log('[SysDes] interaction', event.type, { tag, cls });
      }
      const svgRect =
        d3Container.current?.getBoundingClientRect() || new DOMRect();

      switch (event.type) {
        case 'pointerdown': {
          const { element, point, handedness } = event;
          if (!handedness) return;

          // check if pointerdown occurred on a panel preset
          const presetGroup = element?.closest('g.preset');
          if (presetGroup && yNodes) {
            const presetType = presetGroup.getAttribute('data-preset-type') as
              | 'client'
              | 'load_balancer'
              | 'application_server'
              | 'database'
              | 'cache'
              | null;
            if (presetType) {
              console.log('[SysDes] preset pointerdown', presetType);
              // create at the user's pointer position (converted to simulation coords)
              const simulationX =
                (point.clientX - svgRect.left - transformRef.current.x) /
                transformRef.current.k;
              const simulationY =
                (point.clientY - svgRect.top - transformRef.current.y) /
                transformRef.current.k;
              console.log('[SysDes] will create node at', {
                clientX: point.clientX,
                clientY: point.clientY,
                simulationX,
                simulationY,
              });

              const id = `${presetType}-${Date.now()}`;
              const nameMap: Record<string, string> = {
                client: 'Client',
                load_balancer: 'Load Balancer',
                application_server: 'Application Server',
                database: 'Database',
                cache: 'Cache',
              };

              // create yjs node and start dragging it immediately
              let createdMap: Y.Map<SysDesNodeValue> | null = null;
              doc.transact(() => {
                const m = new Y.Map<SysDesNodeValue>();
                m.set('id', id);
                m.set('type', presetType);
                m.set('name', nameMap[presetType]);
                m.set('x', simulationX);
                m.set('y', simulationY);
                m.set('uuid', crypto.randomUUID());
                yNodes.push([m]);
                createdMap = m;
              });

              if (createdMap) {
                console.log('[SysDes] created node', id, 'starting drag');
                dragStateRef.current[handedness] = {
                  nodeMap: createdMap,
                  offset: { x: 0, y: 0 }, // keep pointer centered on the node
                };
                updateVisualization();
              }
              break;
            }
          }

          // otherwise, try to start dragging an existing node in the canvas
          const parentNode = element?.closest('g.node');
          if (!parentNode) return;
          const nodeId = parentNode.getAttribute('data-id');
          if (!nodeId) return;

          // find yjs map for this node
          let nodeMap: Y.Map<SysDesNodeValue> | null = null;
          for (let i = 0; i < yNodes.length; i++) {
            const n = yNodes.get(i);
            if (n.get('id') === nodeId) {
              nodeMap = n;
              break;
            }
          }
          if (!nodeMap) return;
          console.log('[SysDes] pointerdown on existing node', nodeId);

          const nodeX = (nodeMap.get('x') as number) || 0;
          const nodeY = (nodeMap.get('y') as number) || 0;
          const simulationX =
            (point.clientX - svgRect.left - transformRef.current.x) /
            transformRef.current.k;
          const simulationY =
            (point.clientY - svgRect.top - transformRef.current.y) /
            transformRef.current.k;

          dragStateRef.current[handedness] = {
            nodeMap,
            offset: { x: nodeX - simulationX, y: nodeY - simulationY },
          };
          break;
        }

        case 'pointermove': {
          const { point, handedness } = event;
          if (!handedness) return;
          handleNodeDrag(point, handedness, svgRect);

          // two-hand dwell detection for link toggle
          const leftId = dragStateRef.current.left.nodeMap?.get('id') as
            | string
            | undefined;
          const rightId = dragStateRef.current.right.nodeMap?.get('id') as
            | string
            | undefined;
          if (leftId && rightId && leftId !== rightId && yLinks) {
            const now = Date.now();
            const pairKey = [leftId, rightId].sort().join('|');
            if (twoHandLinkStateRef.current.pairKey !== pairKey) {
              twoHandLinkStateRef.current.pairKey = pairKey;
              twoHandLinkStateRef.current.startTime = now;
              twoHandLinkStateRef.current.toggled = false;
              console.log('[SysDes] link dwell started for', pairKey);
            } else {
              const elapsed = now - twoHandLinkStateRef.current.startTime;
              if (elapsed >= 500 && !twoHandLinkStateRef.current.toggled) {
                // toggle link
                const [a, b] = [leftId, rightId].sort();
                let existingIndex: number | null = null;
                for (let i = 0; i < yLinks.length; i++) {
                  const lm = yLinks.get(i);
                  const s = lm.get('source') as string;
                  const t = lm.get('target') as string;
                  if ((s === a && t === b) || (s === b && t === a)) {
                    existingIndex = i;
                    break;
                  }
                }
                if (existingIndex !== null) {
                  console.log('[SysDes] removing link between', a, b);
                  doc.transact(() => {
                    yLinks.delete(existingIndex, 1);
                  });
                } else {
                  console.log('[SysDes] creating link between', a, b);
                  doc.transact(() => {
                    const lm = new Y.Map<SysDesLinkValue>();
                    lm.set('source', a);
                    lm.set('target', b);
                    yLinks.push([lm]);
                  });
                }
                twoHandLinkStateRef.current.toggled = true;
              }
            }
          } else {
            // not both hands dragging nodes
            twoHandLinkStateRef.current.pairKey = null;
            twoHandLinkStateRef.current.toggled = false;
            twoHandLinkStateRef.current.startTime = 0;
          }
          break;
        }

        case 'pointerup': {
          const { handedness } = event;
          if (!handedness) return;
          console.log('[SysDes] pointerup for hand', handedness);
          dragStateRef.current[handedness] = { nodeMap: null, offset: null };
          // reset two-hand dwell when either hand releases
          twoHandLinkStateRef.current.pairKey = null;
          twoHandLinkStateRef.current.toggled = false;
          twoHandLinkStateRef.current.startTime = 0;
          break;
        }

        case 'drag': {
          if (event.transform && ySharedState) {
            const transform = event.transform as {
              x: number;
              y: number;
              scale?: number;
            };
            const { x, y } = transform;
            const scale = transform.scale || transformRef.current.k;
            console.log('[SysDes] drag transform', { x, y, scale });
            doc.transact(() => {
              ySharedState.set('panX', x);
              ySharedState.set('panY', y);
              ySharedState.set('zoomScale', scale);
            });
            root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
          }
          break;
        }

        case 'zoom': {
          if (event.transform && ySharedState) {
            const { x, y, scale } = event.transform as {
              x: number;
              y: number;
              scale: number;
            };
            console.log('[SysDes] zoom transform', { x, y, scale });
            doc.transact(() => {
              ySharedState.set('panX', x);
              ySharedState.set('panY', y);
              ySharedState.set('zoomScale', scale);
            });
            root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
          }
          break;
        }

        default:
          break;
      }
    };

    // listen for custom interaction events on parent of container
    const parent = d3Container.current?.parentElement;
    if (parent) {
      parent.addEventListener('interaction', ((
        e: CustomEvent<InteractionEvent>
      ) => handleInteraction(e.detail)) as EventListener);
    }

    // observe yjs changes
    const observer = () => updateVisualization();
    yNodes.observeDeep(observer);
    if (yLinks) yLinks.observeDeep(observer);
    ySharedState.observe(observer);

    // initial draw
    updateVisualization();

    return () => {
      yNodes.unobserveDeep(observer);
      if (yLinks) yLinks.unobserveDeep(observer);
      ySharedState.unobserve(observer);
      if (parent) {
        parent.removeEventListener('interaction', ((
          e: CustomEvent<InteractionEvent>
        ) => handleInteraction(e.detail)) as EventListener);
      }
    };
  }, [doc, syncStatus, yNodes, yLinks, ySharedState]);

  // render a minimal waiting view until synced and doc is ready
  if (!syncStatus || !doc) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
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
            System Design
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
                background: 'linear-gradient(to right, #1E90FF, #1E90FF)',
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

  // panel content with presets; items are marked interactable so gestures can target them
  return (
    <>
      {/* main d3 container */}
      <div
        ref={d3Container}
        style={{
          width: '100%',
          height: '100%',
          pointerEvents: 'all',
          touchAction: 'none',
        }}
      />

      {/* info panel svg structure with presets */}
      <svg
        ref={panelSvgRef}
        width={panelWidth}
        height={totalHeight}
        className='interactable'
        style={{
          position: 'fixed',
          top: '0',
          left: '0',
          background: panelBackground,
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          zIndex: 1000,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          backdropFilter: 'blur(12px)',
          pointerEvents: 'all',
        }}
      >
        <defs>
          <filter id='panel-text-shadow'>
            <feDropShadow dx='0' dy='1' stdDeviation='1' floodOpacity='0.3' />
          </filter>
        </defs>
        {/*
          add a transparent rect first; presets will be appended after so they stay on top for interactions
        */}
        <g className='panel-content'>
          <rect
            className='interactable'
            x={0}
            y={0}
            width={panelWidth}
            height={totalHeight}
            fill='transparent'
            style={{ pointerEvents: 'all' }}
          />
          {/* preset items - each is a group with data-preset-type */}
          <g transform='translate(16, 24)'>
            {/* title */}
            <text
              x={0}
              y={0}
              fill='#fff'
              fontSize={18}
              style={{ filter: 'url(#panel-text-shadow)' }}
            >
              presets
            </text>

            {/* items list */}
            {[
              { key: 'client', label: 'Client', fill: '#90cdf4' },
              { key: 'load_balancer', label: 'Load Balancer', fill: '#f6ad55' },
              {
                key: 'application_server',
                label: 'Application Server',
                fill: '#68d391',
              },
              { key: 'database', label: 'Database', fill: '#f56565' },
              { key: 'cache', label: 'Cache', fill: '#b794f4' },
            ].map((item, idx) => {
              const y = 28 + idx * 90;
              return (
                <g
                  key={item.key}
                  className='preset interactable draggable'
                  data-preset-type={item.key}
                  transform={`translate(0, ${y})`}
                >
                  <rect
                    x={0}
                    y={-10}
                    width={panelWidth - 32}
                    height={70}
                    rx={10}
                    ry={10}
                    fill='rgba(0,0,0,0.06)'
                    className='interactable draggable'
                  />
                  <rect
                    x={12}
                    y={0}
                    width={56}
                    height={40}
                    rx={8}
                    ry={8}
                    fill={item.fill}
                    stroke='#1A202C'
                    strokeWidth={1.5}
                    className='interactable draggable'
                  />
                  <text
                    x={84}
                    y={24}
                    fill='#fff'
                    fontSize={16}
                    className='interactable draggable'
                    style={{ pointerEvents: 'all' }}
                  >
                    {item.label}
                  </text>
                  <text
                    x={84}
                    y={44}
                    fill='#cbd5e0'
                    fontSize={12}
                    className='interactable draggable'
                    style={{ pointerEvents: 'all' }}
                  >
                    drag into canvas
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
    </>
  );
};

export default SysDes;
