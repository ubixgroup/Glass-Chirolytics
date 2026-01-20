import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '@/context/YjsContext';
import * as d3 from 'd3';
import moviesData from '@/assets/movies/movies2.json'; // updated data import
import { InteractionEvent, InteractionPoint } from '@/types/interactionTypes';
import { GetCurrentTransformFn } from '@/utils/interactionHandlers';

// define shared value types for y.map
type NodeMapValue = string | number | boolean | undefined | string[]; // allow string arrays for genres etc.
type LinkMapValue = string;

// d3 specific types - extend SimulationNodeDatum with our required properties
interface D3BaseNode extends d3.SimulationNodeDatum {
  id: string;
  type: 'movie' | 'actor' | 'director'; // specific node types
  name: string; // for movies: title, for actors/directors: name
  uuid: string;
}

interface D3MovieNode extends D3BaseNode {
  type: 'movie';
  released?: number;
  tagline?: string;
  genre?: string[];
}

interface D3ActorNode extends D3BaseNode {
  type: 'actor';
  born?: number;
}

interface D3DirectorNode extends D3BaseNode {
  type: 'director';
  born?: number;
}

type D3Node = D3MovieNode | D3ActorNode | D3DirectorNode;

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  type: 'acts_in' | 'directed'; // specific link types
}

// constants for link styling
const DEFAULT_LINK_COLOR = '#aaa';
const DIRECTED_LINK_COLOR = '#777'; // existing color for directed links
const DEFAULT_LINK_OPACITY = 0.5;
const DEFAULT_LINK_STROKE_WIDTH = 3; // increased thickness
const HIGHLIGHTED_LINK_COLOR = '#FFD700'; // gold
const HIGHLIGHTED_LINK_OPACITY = 1;
const HIGHLIGHTED_LINK_STROKE_WIDTH = 4; // increased thickness

// props interface for the Movies component
interface MoviesProps {
  getCurrentTransformRef: React.MutableRefObject<GetCurrentTransformFn | null>;
}

// helper function to get node id from a link's source or target
function getNodeIdFromLinkEnd(node: D3Node | string | number): string {
  if (typeof node === 'object' && node !== null && 'id' in node) {
    // it's a D3Node object
    return (node as D3Node).id;
  }
  // it's a string or number (id directly)
  return String(node);
}

// helper function to check if a link is connected to a node
function isLinkConnectedToNode(link: D3Link, nodeId: string): boolean {
  const sourceId = getNodeIdFromLinkEnd(link.source);
  const targetId = getNodeIdFromLinkEnd(link.target);
  return sourceId === nodeId || targetId === nodeId;
}

// helper function to get the other end of a link given one node id
function getOtherEndOfLink(link: D3Link, nodeId: string): string {
  const sourceId = getNodeIdFromLinkEnd(link.source);
  const targetId = getNodeIdFromLinkEnd(link.target);
  return sourceId === nodeId ? targetId : sourceId;
}

// helper function to find all links connected to a node
function findConnectedLinks(allLinks: D3Link[], nodeId: string): D3Link[] {
  return allLinks.filter((link) => isLinkConnectedToNode(link, nodeId));
}

// helper function to find the shortest path between two nodes using bfs
function findShortestPathForMovies(
  allLinks: D3Link[],
  startNodeId: string,
  endNodeId: string
): D3Link[] {
  const queue: { nodeId: string; path: D3Link[] }[] = [
    { nodeId: startNodeId, path: [] },
  ];
  const visitedNodeIds = new Set<string>([startNodeId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const { nodeId, path } = current;

    const connectedLinks = findConnectedLinks(allLinks, nodeId);

    for (const link of connectedLinks) {
      const neighborNodeId = getOtherEndOfLink(link, nodeId);

      if (neighborNodeId === endNodeId) {
        return [...path, link]; // path found
      }

      if (!visitedNodeIds.has(neighborNodeId)) {
        visitedNodeIds.add(neighborNodeId);
        queue.push({ nodeId: neighborNodeId, path: [...path, link] });
      }
    }
  }
  return []; // no path found
}

// helper function to compact/prune the yjs document
function pruneYDoc(doc: Y.Doc) {
  console.log('[Yjs] Running document compaction for movies...');
  const beforeSize = Y.encodeStateAsUpdate(doc).byteLength;

  try {
    // create a new temporary document
    const tempDoc = new Y.Doc();

    // get current data from original doc
    const originalNodes = doc.getArray<Y.Map<NodeMapValue>>('movieGraphNodes'); // updated yjs name
    const originalLinks = doc.getArray<Y.Map<LinkMapValue>>('movieGraphLinks'); // updated yjs name
    const originalSharedState = doc.getMap<string | boolean | null | number>(
      'movieGraphSharedState' // updated yjs name
    );

    // get references to collections in temp doc
    const tempNodes = tempDoc.getArray<Y.Map<NodeMapValue>>('movieGraphNodes');
    const tempLinks = tempDoc.getArray<Y.Map<LinkMapValue>>('movieGraphLinks');
    const tempSharedState = tempDoc.getMap<string | boolean | null | number>(
      'movieGraphSharedState'
    );

    // copy nodes data
    tempDoc.transact(() => {
      // copy nodes
      for (let i = 0; i < originalNodes.length; i++) {
        const originalNode = originalNodes.get(i);
        const newNode = new Y.Map<NodeMapValue>();

        // copy all properties
        originalNode.forEach((value: NodeMapValue, key: string) => {
          newNode.set(key, value);
        });

        tempNodes.push([newNode]);
      }

      // copy links
      for (let i = 0; i < originalLinks.length; i++) {
        const originalLink = originalLinks.get(i);
        const newLink = new Y.Map<LinkMapValue>();

        // copy all properties
        originalLink.forEach((value: LinkMapValue, key: string) => {
          newLink.set(key, value);
        });

        tempLinks.push([newLink]);
      }

      // copy shared state
      originalSharedState.forEach(
        (value: string | boolean | null | number, key: string) => {
          tempSharedState.set(key, value);
        }
      );
    });

    // create snapshot of the cleaned data
    const cleanSnapshot = Y.encodeStateAsUpdate(tempDoc);

    // clear original doc
    doc.transact(() => {
      while (originalNodes.length > 0) originalNodes.delete(0);
      while (originalLinks.length > 0) originalLinks.delete(0);
      originalSharedState.forEach(
        (_: string | boolean | null | number, key: string) =>
          originalSharedState.delete(key)
      );
    });

    // apply clean snapshot to original doc
    Y.applyUpdate(doc, cleanSnapshot);

    const afterSize = Y.encodeStateAsUpdate(doc).byteLength;
    const reduction = Math.max(
      0,
      Math.round((1 - afterSize / beforeSize) * 100)
    );
    console.log(
      `[Yjs] Movie Compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
    );

    // cleanup temporary doc
    tempDoc.destroy();
  } catch (err) {
    console.error('[Yjs] Movie Compaction failed:', err);

    // fallback to simple snapshot-based compaction if the more aggressive approach fails
    try {
      const snapshot = Y.encodeStateAsUpdate(doc);
      doc.transact(() => {
        Y.applyUpdate(doc, snapshot);
      });

      const afterSize = Y.encodeStateAsUpdate(doc).byteLength;
      const reduction = Math.max(
        0,
        Math.round((1 - afterSize / beforeSize) * 100)
      );
      console.log(
        `[Yjs] Simple movie compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
      );
    } catch (fallbackErr) {
      console.error(
        '[Yjs] Fallback movie compaction also failed:',
        fallbackErr
      );
    }
  }
}

const Movies: React.FC<MoviesProps> = ({ getCurrentTransformRef }) => {
  // updated component name
  // get doc from context (no awareness)
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;

  // reference to the d3 container
  const d3Container = useRef<HTMLDivElement | null>(null);

  // setup yjs shared arrays
  const yNodes = doc!.getArray<Y.Map<NodeMapValue>>('movieGraphNodes'); // updated yjs name
  const yLinks = doc!.getArray<Y.Map<LinkMapValue>>('movieGraphLinks'); // updated yjs name

  // add shared state with yjs
  const ySharedState = doc!.getMap<string | boolean | null | string[] | number>( // allow string[] for hoveredNodeIds
    'movieGraphSharedState' // updated yjs name
  );

  // add client click selections map - maps userid to array of selected node ids
  const yClientClickSelections = doc!.getMap<string[]>(
    'clientClickMovieSelections'
  ); // updated yjs name

  // reference to track initialization
  const isInitializedRef = useRef(false);

  // track current transform for gestures via ref only
  // ref to track current transform values without triggering effect re-runs
  const transformRef = useRef<{ k: number; x: number; y: number }>({
    k: 1,
    x: 0,
    y: 0,
  });

  // add drag state ref to track which nodes are being dragged by which hand
  const dragStateRef = useRef<{
    left: {
      nodeMap: Y.Map<NodeMapValue> | null;
      offset: { x: number; y: number } | null;
    };
    right: {
      nodeMap: Y.Map<NodeMapValue> | null;
      offset: { x: number; y: number } | null;
    };
  }>({
    left: { nodeMap: null, offset: null },
    right: { nodeMap: null, offset: null },
  });

  // only keep states for non-d3 related variables
  const [syncStatus, setSyncStatus] = useState<boolean>(false);
  const [userId] = useState<string>(() => crypto.randomUUID());

  // fixed dimensions for the svg canvas
  const fixedWidth = 1280;
  const fixedHeight = 720;

  // left panel width for tooltip/info
  const tooltipWidth = fixedWidth * 0.25; // keep tooltip for now

  // set up the getCurrentTransform function for interaction handlers
  useEffect(() => {
    getCurrentTransformRef.current = () => ({
      scale: transformRef.current.k,
      x: transformRef.current.x,
      y: transformRef.current.y,
    });

    // cleanup function to clear the ref when component unmounts
    return () => {
      getCurrentTransformRef.current = null;
    };
  }, [getCurrentTransformRef]);

  // track sync status (simple timeout approach)
  useEffect(() => {
    if (!doc) return;
    // assume synced after a short delay
    const timeout = setTimeout(() => {
      console.log('assuming sync after timeout for movie visualization');
      setSyncStatus(true);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [doc]);

  // performance monitoring intervals and compaction
  useEffect(() => {
    if (!doc || !syncStatus) return;

    // monitor yjs document size
    const yjsMonitor = setInterval(() => {
      const byteLength = Y.encodeStateAsUpdate(doc).byteLength;
      console.log(`[Yjs Movie] Document size: ${byteLength} bytes`);
    }, 60000); // every 60 seconds

    // monitor dom elements
    const domMonitor = setInterval(() => {
      const nodeCount = document.querySelectorAll('g.node').length;
      const tooltipCount = document.querySelectorAll('g.tooltip').length;
      console.log(
        `[DOM Movie] ${nodeCount} nodes, ${tooltipCount} tooltips in DOM`
      );
    }, 10000);

    // periodic document compaction to prevent unbounded growth
    const compactionInterval = setInterval(() => {
      pruneYDoc(doc);
    }, 300000); // every 5 minutes

    // cleanup intervals on unmount
    return () => {
      clearInterval(yjsMonitor);
      clearInterval(domMonitor);
      clearInterval(compactionInterval);
    };
  }, [doc, syncStatus]);

  // initialize graph data from json if ynodes is empty after sync
  useEffect(() => {
    // wait for sync and check if nodes are empty
    if (!syncStatus || yNodes.length > 0) {
      return;
    }

    console.log('initializing movie graph data from json');

    const initialNodes: Y.Map<NodeMapValue>[] = [];
    const initialLinks: Y.Map<LinkMapValue>[] = [];
    const nodeIds = new Set<string>(); // to avoid duplicate nodes

    // we'll set positions later with d3 layout
    const defaultX = fixedWidth / 2;
    const defaultY = fixedHeight / 2;

    // process movies
    moviesData.movies.forEach((movie) => {
      if (nodeIds.has(movie.id)) return;
      const yNode = new Y.Map<NodeMapValue>();
      yNode.set('id', movie.id);
      yNode.set('name', movie.title); // 'name' will be title for movies
      yNode.set('type', 'movie');
      yNode.set('released', movie.released);
      yNode.set('tagline', movie.tagline);
      yNode.set('genre', movie.genre as string[]); // cast to string[]
      yNode.set('x', defaultX);
      yNode.set('y', defaultY);
      yNode.set('uuid', crypto.randomUUID());
      initialNodes.push(yNode);
      nodeIds.add(movie.id);
    });

    // process actors
    moviesData.actors.forEach((actor) => {
      if (nodeIds.has(actor.id)) return;
      const yNode = new Y.Map<NodeMapValue>();
      yNode.set('id', actor.id);
      yNode.set('name', actor.name);
      yNode.set('type', 'actor');
      yNode.set('born', actor.born);
      yNode.set('x', defaultX);
      yNode.set('y', defaultY);
      yNode.set('uuid', crypto.randomUUID());
      initialNodes.push(yNode);
      nodeIds.add(actor.id);
    });

    // process directors
    moviesData.directors.forEach((director) => {
      if (nodeIds.has(director.id)) return;
      const yNode = new Y.Map<NodeMapValue>();
      yNode.set('id', director.id);
      yNode.set('name', director.name);
      yNode.set('type', 'director');
      // 'born' might not exist on all director objects in movies.json, handle safely
      if (director.born !== undefined) {
        yNode.set('born', director.born);
      }
      yNode.set('x', defaultX);
      yNode.set('y', defaultY);
      yNode.set('uuid', crypto.randomUUID());
      initialNodes.push(yNode);
      nodeIds.add(director.id);
    });

    // process links
    // actor -> movie (acts_in)
    moviesData.actors.forEach((actor) => {
      actor.roles.forEach((role) => {
        const yLink = new Y.Map<LinkMapValue>();
        yLink.set('source', actor.id);
        yLink.set('target', role.movie_id);
        yLink.set('type', 'acts_in');
        // yLink.set('role_name', role.character); // optional: add role name to link
        initialLinks.push(yLink);
      });
    });

    // director -> movie (directed)
    moviesData.directors.forEach((director) => {
      director.movies.forEach((movieId) => {
        const yLink = new Y.Map<LinkMapValue>();
        yLink.set('source', director.id);
        yLink.set('target', movieId);
        yLink.set('type', 'directed');
        initialLinks.push(yLink);
      });
    });

    // use transaction to batch updates
    doc!.transact(() => {
      yNodes.push(initialNodes);
      yLinks.push(initialLinks);
    });
  }, [syncStatus, doc, yNodes, yLinks]);

  // effect to sync transform state from yjs
  useEffect(() => {
    if (!doc || !syncStatus) return;

    // get initial transform from yjs or set default
    const initialTransform = {
      k: (ySharedState.get('zoomScale') as number) || 1,
      x: (ySharedState.get('panX') as number) || 0,
      y: (ySharedState.get('panY') as number) || 0,
    };

    transformRef.current = initialTransform;
    // no react state; track via ref only

    // observe zoom/pan changes
    const observer = () => {
      const scale = (ySharedState.get('zoomScale') as number) || 1;
      const x = (ySharedState.get('panX') as number) || 0;
      const y = (ySharedState.get('panY') as number) || 0;

      // only update if values are different to avoid loops
      if (
        scale !== transformRef.current.k ||
        x !== transformRef.current.x ||
        y !== transformRef.current.y
      ) {
        transformRef.current = { k: scale, x, y };
        // no react state; track via ref only

        // apply transform to root if it exists
        const root = d3.select('#movie-root'); // updated root id
        if (!root.empty()) {
          root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
        }
      }
    };

    ySharedState.observe(observer);
    return () => ySharedState.unobserve(observer);
  }, [doc, syncStatus, ySharedState]);

  // d3 visualization setup and update
  useEffect(() => {
    if (!syncStatus || !d3Container.current) return;

    // only initialize once
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    console.log('initializing d3 movie visualization');

    // clear any existing content
    d3.select(d3Container.current).selectAll('*').remove();

    // create svg element
    const svg = d3
      .select(d3Container.current)
      .append('svg')
      .attr('width', fixedWidth)
      .attr('height', fixedHeight)
      .attr('class', 'interactable')
      .attr('viewBox', [0, 0, fixedWidth, fixedHeight])
      .attr('style', 'background: transparent; max-width: 100%; height: auto;');

    // apply initial transform from yjs state or default
    const initialScale = (ySharedState.get('zoomScale') as number) || 1;
    const initialX = (ySharedState.get('panX') as number) || 0;
    const initialY = (ySharedState.get('panY') as number) || 0;
    transformRef.current = { k: initialScale, x: initialX, y: initialY };

    // create a root group for all content that will be transformed
    const root = svg
      .append('g')
      .attr('class', 'root')
      .attr('id', 'movie-root') // updated root id
      .attr(
        'transform',
        `translate(${initialX}, ${initialY}) scale(${initialScale})`
      );

    // create groups for links and nodes
    const linkGroup = root.append('g').attr('class', 'links');
    const nodeGroup = root.append('g').attr('class', 'nodes');

    // helper function to handle node dragging
    const handleNodeDrag = (
      point: InteractionPoint,
      handedness: 'left' | 'right',
      svgRect: DOMRect
    ) => {
      const dragState = dragStateRef.current[handedness];
      if (!dragState.nodeMap || !dragState.offset) return;

      // calculate simulation coordinates
      const simulationX =
        (point.clientX - svgRect.left - transformRef.current.x) /
        transformRef.current.k;
      const simulationY =
        (point.clientY - svgRect.top - transformRef.current.y) /
        transformRef.current.k;

      // update node position in yjs
      const newX = simulationX + dragState.offset.x;
      const newY = simulationY + dragState.offset.y;

      doc!.transact(() => {
        dragState.nodeMap?.set('x', newX);
        dragState.nodeMap?.set('y', newY);
      });

      // update visualization immediately for smooth dragging
      updateVisualization();
    };

    // create a custom event handler for gesture interactions
    const handleInteraction = (event: InteractionEvent) => {
      // get svg bounding rect for coordinate calculations
      const svgRect =
        d3Container.current?.getBoundingClientRect() || new DOMRect();

      switch (event.type) {
        case 'pointerdown': {
          // handle start of drag operation
          const { element, point, handedness } = event;
          if (!handedness) return;

          // find the parent node group element that contains the data-id
          const parentNode = element?.closest('g.node');
          if (!parentNode) return;

          const nodeId = parentNode.getAttribute('data-id');
          if (!nodeId) return;

          // find the y.map for this node
          let nodeMap: Y.Map<NodeMapValue> | null = null;
          for (let i = 0; i < yNodes.length; i++) {
            const node = yNodes.get(i);
            if (node.get('id') === nodeId) {
              nodeMap = node;
              break;
            }
          }

          if (!nodeMap) return;

          // calculate offset between pointer and node center
          const nodeX = (nodeMap.get('x') as number) || 0;
          const nodeY = (nodeMap.get('y') as number) || 0;

          // convert client coordinates to simulation space
          const simulationX =
            (point.clientX - svgRect.left - transformRef.current.x) /
            transformRef.current.k;
          const simulationY =
            (point.clientY - svgRect.top - transformRef.current.y) /
            transformRef.current.k;

          // save drag state
          dragStateRef.current[handedness] = {
            nodeMap,
            offset: {
              x: nodeX - simulationX,
              y: nodeY - simulationY,
            },
          };
          break;
        }

        case 'pointermove': {
          // handle drag movement
          const { point, handedness } = event;
          if (!handedness) return;

          handleNodeDrag(point, handedness, svgRect);
          break;
        }

        case 'pointerup': {
          // handle end of drag operation
          const { handedness } = event;
          if (!handedness) return;

          // clear drag state for this hand
          dragStateRef.current[handedness] = {
            nodeMap: null,
            offset: null,
          };
          break;
        }

        case 'pointerover': {
          // handle hover events (from handleone or handlegrabbing)
          const element = event.element;

          if (!element || !(element instanceof SVGElement)) return;

          // get data from the element if it's a node
          if (
            (element.tagName === 'circle' ||
              element.tagName === 'rect' ||
              element.tagName === 'ellipse') && // added ellipse for directors
            element.classList.contains('node-shape')
          ) {
            // find the parent node group element that contains the data-id
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id');
            if (nodeId) {
              // get current hovered node ids and add this one if not already in the list
              const currentHoveredNodeIds =
                (ySharedState.get('hoveredNodeIds') as string[]) || [];
              if (!currentHoveredNodeIds.includes(nodeId)) {
                ySharedState.set('hoveredNodeIds', [
                  ...currentHoveredNodeIds,
                  nodeId,
                ]);
                updateVisualization();
              }
            }
          }
          break;
        }

        case 'pointerout': {
          // handle hover end events (from handleone or handlegrabbing)
          const element = event.element;
          if (!element || !(element instanceof SVGElement)) return;

          // if this is a node, remove only this specific node id from the hovered list
          if (
            (element.tagName === 'circle' ||
              element.tagName === 'rect' ||
              element.tagName === 'ellipse') && // added ellipse
            element.classList.contains('node-shape')
          ) {
            // find the parent node group element that contains the data-id
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id');

            if (nodeId) {
              const currentHoveredNodeIds =
                (ySharedState.get('hoveredNodeIds') as string[]) || [];
              const updatedHoveredNodeIds = currentHoveredNodeIds.filter(
                (id) => id !== nodeId
              );
              ySharedState.set('hoveredNodeIds', updatedHoveredNodeIds);
              updateVisualization();
            }
          }
          break;
        }

        case 'pointerselect': {
          // handle selection events (from handlethumbindex)
          const element = event.element;
          if (!element || !(element instanceof SVGElement)) return;

          if (element.classList.contains('node-shape')) {
            // find the parent node group element that contains the data-id
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id');
            if (nodeId) {
              // toggle selection
              const currentSelections =
                yClientClickSelections.get(userId) || [];
              if (currentSelections.includes(nodeId)) {
                // remove node from selections
                yClientClickSelections.set(
                  userId,
                  currentSelections.filter((id) => id !== nodeId)
                );
              } else {
                // add node to selections
                yClientClickSelections.set(userId, [
                  ...currentSelections,
                  nodeId,
                ]);
              }
              updateVisualization();
            }
          }
          break;
        }

        case 'drag': {
          // handle drag events for panning
          if (event.transform) {
            const transform = event.transform as {
              x: number;
              y: number;
              scale?: number;
            };
            const { x, y } = transform;
            const scale = transform.scale || transformRef.current.k;

            // update shared transform via yjs
            doc!.transact(() => {
              ySharedState.set('panX', x);
              ySharedState.set('panY', y);
              ySharedState.set('zoomScale', scale);
            });

            // apply the transform to the root group
            root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
          }
          break;
        }

        case 'zoom': {
          // handle zoom events
          if (event.transform) {
            const { x, y, scale } = event.transform;

            // update shared transform via yjs
            doc!.transact(() => {
              ySharedState.set('panX', x);
              ySharedState.set('panY', y);
              ySharedState.set('zoomScale', scale);
            });

            // apply the transform to the root group
            root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
          }
          break;
        }
      }
    };

    // add event listener for custom interaction events
    const parent = d3Container.current?.parentElement;
    if (parent) {
      parent.addEventListener('interaction', ((
        e: CustomEvent<InteractionEvent>
      ) => handleInteraction(e.detail)) as EventListener);
    }

    // create arrow marker for directed links
    svg
      .append('defs')
      .append('marker')
      .attr('id', 'movie-arrowhead') // unique id for movie arrows
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 40) // adjusted for new node radius 35
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#777'); // slightly lighter arrow

    // define a drop shadow filter
    const defs = svg.select('defs'); // re-select defs or use the existing one if available
    const filter = defs
      .append('filter')
      .attr('id', 'movie-drop-shadow') // unique id for the filter
      .attr('height', '130%'); // adjust filter region if shadow is clipped

    filter
      .append('feGaussianBlur')
      .attr('in', 'SourceAlpha')
      .attr('stdDeviation', 3) // blur amount
      .attr('result', 'blur');

    filter
      .append('feOffset')
      .attr('in', 'blur')
      .attr('dx', 2) // horizontal offset
      .attr('dy', 2) // vertical offset
      .attr('result', 'offsetBlur');

    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'offsetBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // create tooltip group with modern styling
    const tooltip = svg
      .append('g')
      .attr('class', 'tooltip')
      .attr('transform', 'translate(0,0)');

    // add gradient for tooltip
    const tooltipGradient = svg.append('defs').append('linearGradient');

    tooltipGradient
      .attr('id', 'movie-tooltip-gradient') // unique id
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    tooltipGradient
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#1a202c') // match senate tooltip top color
      .attr('stop-opacity', 0.98);

    tooltipGradient
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#171923') // match senate tooltip bottom color
      .attr('stop-opacity', 0.98);

    // draw panel with only right corners rounded (left corners square)
    const panelRadius = 12;
    const panelPath = `M0,0 L${tooltipWidth - panelRadius},0 Q${tooltipWidth},0 ${tooltipWidth},${panelRadius} L${tooltipWidth},${fixedHeight - panelRadius} Q${tooltipWidth},${fixedHeight} ${tooltipWidth - panelRadius},${fixedHeight} L0,${fixedHeight} Z`;
    tooltip
      .append('path')
      .attr('d', panelPath)
      .attr('fill', 'url(#movie-tooltip-gradient)'); // use unique gradient id

    // tooltip content containers with text wrapping
    const tooltipContent = tooltip
      .append('g')
      .attr('transform', `translate(20, 40)`);

    // add title text element with proper styling
    tooltipContent
      .append('text')
      .attr('class', 'tt-title')
      .attr('x', 0)
      .attr('y', 0)
      .attr('font-size', '26px') // slightly smaller title for movie context
      .attr('fill', '#ffffff') // match senate title color
      .attr('font-weight', '500');

    // general purpose text lines for tooltip
    const textLineClasses = [
      'tt-info1',
      'tt-info2',
      'tt-info3',
      'tt-info4',
      'tt-info5',
      'tt-info6',
    ];
    textLineClasses.forEach((className, index) => {
      tooltipContent
        .append('text')
        .attr('class', className)
        .attr('x', 0)
        .attr('y', 30 + index * 30) // adjusted spacing
        .attr('font-size', '18px') // smaller info text
        .attr('fill', '#cbd5e0') // match senate subtext color
        .attr('font-weight', '300');
    });

    // adjust the main visualization area
    linkGroup.attr('transform', `translate(${tooltipWidth}, 0)`);
    nodeGroup.attr('transform', `translate(${tooltipWidth}, 0)`);

    // helper function to convert node maps to d3 nodes
    const mapNodesToD3 = (): D3Node[] => {
      const nodes: D3Node[] = [];
      for (let i = 0; i < yNodes.length; i++) {
        const node = yNodes.get(i);
        const id = node.get('id') as string;
        const type = node.get('type') as 'movie' | 'actor' | 'director';
        const name = node.get('name') as string;
        const x = (node.get('x') as number) || fixedWidth / 2;
        const y = (node.get('y') as number) || fixedHeight / 2;
        const uuid = node.get('uuid') as string;

        let d3Node: D3Node;

        if (type === 'movie') {
          d3Node = {
            id,
            type,
            name, // title
            x,
            y,
            uuid,
            released: node.get('released') as number | undefined,
            tagline: node.get('tagline') as string | undefined,
            genre: node.get('genre') as string[] | undefined,
          };
        } else if (type === 'actor') {
          d3Node = {
            id,
            type,
            name,
            x,
            y,
            uuid,
            born: node.get('born') as number | undefined,
          };
        } else {
          // director
          d3Node = {
            id,
            type,
            name,
            x,
            y,
            uuid,
            born: node.get('born') as number | undefined,
          };
        }
        nodes.push(d3Node);
      }
      return nodes;
    };

    // helper function to convert link maps to d3 links
    const mapLinksToD3 = (nodeMap: Map<string, D3Node>): D3Link[] => {
      const links: D3Link[] = [];
      for (let i = 0; i < yLinks.length; i++) {
        const link = yLinks.get(i);
        const sourceId = link.get('source') as string;
        const targetId = link.get('target') as string;
        const type = link.get('type') as 'acts_in' | 'directed';

        const source = nodeMap.get(sourceId) || sourceId;
        const target = nodeMap.get(targetId) || targetId;

        links.push({ source, target, type });
      }
      return links;
    };

    // function to update the tooltip content
    const updateSelectedNodesInfo = (
      nodes: D3Node[] | D3Node | null,
      pathContext?: {
        startName: string;
        endName: string;
        pathNodeNames: string[];
      }
    ) => {
      const nodesArray = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];

      // helper to capitalize a single word's first letter
      const capitalize = (value: string): string =>
        value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

      // helper to wrap text to roughly fit a max width
      const wrapText = (text: string, width: number): string[] => {
        const words = text.split(/\s+/);
        const lines: string[] = [];
        let currentLine = '';
        for (const word of words) {
          if ((currentLine + word).length * 8 > width) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine += (currentLine ? ' ' : '') + word;
          }
        }
        if (currentLine) lines.push(currentLine);
        return lines;
      };

      // clear all text elements first
      tooltip.select('.tt-title').text('');
      textLineClasses.forEach((cls) => tooltip.select(`.${cls}`).text(''));

      // always remove all list items no matter what state we're in
      tooltipContent.selectAll('.node-list-item').remove();

      // if we are showing a shortest-path highlight, display a concise path summary
      if (pathContext && pathContext.pathNodeNames.length > 0) {
        const hopCount = Math.max(0, pathContext.pathNodeNames.length - 1);
        tooltip.select('.tt-title').text('Shortest Path');
        tooltip
          .select('.tt-info1')
          .text(`Between: ${pathContext.startName} and ${pathContext.endName}`);
        tooltip
          .select('.tt-info2')
          .text(`Length: ${hopCount} ${hopCount === 1 ? 'Link' : 'Links'}`);
        const maxWidth = tooltipWidth - 40;
        const pathLines = wrapText(
          `Path: ${pathContext.pathNodeNames.join(' → ')}`,
          maxWidth
        );
        tooltip.select('.tt-info3').text(pathLines[0] || '');
        tooltip.select('.tt-info4').text(pathLines[1] || '');
        tooltip.select('.tt-info5').text(pathLines[2] || '');
        tooltip.select('.tt-info6').text(pathLines[3] || '');
      } else if (nodesArray.length === 0) {
        tooltip.select('.tt-title').text('Movie Graph Explorer');
        tooltip.select('.tt-info1').text('Hover over nodes for details');
        tooltip.select('.tt-info2').text('Select nodes for more info');
      } else if (nodesArray.length === 1) {
        const node = nodesArray[0];
        tooltip.select('.tt-title').text(node.name);
        tooltip.select('.tt-info1').text(`Type: ${capitalize(node.type)}`);
        if (node.type === 'movie') {
          const movieNode = node as D3MovieNode;
          tooltip
            .select('.tt-info2')
            .text(`Released: ${movieNode.released || 'N/A'}`);
          tooltip
            .select('.tt-info3')
            .text(`Genre: ${(movieNode.genre || []).join(', ')}`);
          tooltip
            .select('.tt-info4')
            .text(`Tagline: ${movieNode.tagline || 'N/A'}`);
        } else if (node.type === 'actor' || node.type === 'director') {
          const personNode = node as D3ActorNode | D3DirectorNode;
          tooltip.select('.tt-info2').text(`Born: ${personNode.born || 'N/A'}`);
        }
      } else {
        // multiple nodes - show count as title
        tooltip
          .select('.tt-title')
          .text(
            `${nodesArray.length} ${
              nodesArray.length === 1 ? 'Node' : 'Nodes'
            } Selected`
          );

        // show up to 5 node names as a bullet list
        const maxToShow = 5;
        const namesToShow = nodesArray.slice(0, maxToShow);
        const additionalCount = nodesArray.length - maxToShow;

        const maxWidth = tooltipWidth - 40; // padding on both sides

        // wrapText helper defined earlier in this function is reused here

        let currentY = 35;
        const lineHeight = 25; // smaller line height for movie list

        namesToShow.forEach((node) => {
          const nameWithBullet = `• ${node.name} (${capitalize(node.type)})`;
          const wrappedLines = wrapText(nameWithBullet, maxWidth);

          const itemGroup = tooltipContent
            .append('g')
            .attr('class', 'node-list-item');

          wrappedLines.forEach((line, lineIndex) => {
            itemGroup
              .append('text')
              .attr('x', 0)
              .attr('y', currentY + lineIndex * lineHeight)
              .attr('font-size', '16px') // smaller font for list
              .attr('fill', '#cbd5e0') // match senate subtext color
              .attr('font-weight', '300')
              .text(line);
          });
          currentY += wrappedLines.length * lineHeight + 8; // spacing
        });

        if (additionalCount > 0) {
          tooltipContent
            .append('text')
            .attr('class', 'node-list-item')
            .attr('x', 0)
            .attr('y', currentY)
            .attr('font-size', '14px') // smaller font
            .attr('fill', '#cbd5e0')
            .attr('font-weight', '300')
            .attr('font-style', 'italic')
            .text(`And ${additionalCount} more...`);
        }
      }
    };

    // function to update the visualization
    const updateVisualization = () => {
      const nodes = mapNodesToD3();
      const nodeMap = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMap.set(n.id, n));
      const links = mapLinksToD3(nodeMap);

      const linkKeyFn = (d: D3Link): string => {
        const source = d.source as D3Node; // type assertion
        const target = d.target as D3Node; // type assertion
        return `${source.id}-${target.id}-${d.type}`;
      };

      const link = linkGroup
        .selectAll<SVGLineElement, D3Link>('line')
        .data(links, linkKeyFn);

      link.exit().remove();

      const linkEnter = link.enter().append('line');
      // default styles will be applied below, marker remains based on type
      // .attr('marker-end', (d) =>  // this line will be removed
      //   d.type === 'directed' ? 'url(#movie-arrowhead)' : ''
      // );

      const linkMerge = linkEnter.merge(link);

      // apply dynamic positions first
      linkMerge
        .attr('x1', (d: D3Link) => {
          const source = d.source as D3Node;
          return source.x || 0;
        })
        .attr('y1', (d: D3Link) => {
          const source = d.source as D3Node;
          return source.y || 0;
        })
        .attr('x2', (d: D3Link) => {
          const target = d.target as D3Node;
          return target.x || 0;
        })
        .attr('y2', (d: D3Link) => {
          const target = d.target as D3Node;
          return target.y || 0;
        });

      // node handling
      const node = nodeGroup
        .selectAll<SVGGElement, D3Node>('g.node')
        .data(nodes, (d: D3Node) => d.uuid);

      node.exit().remove();

      const nodeEnter = node
        .enter()
        .append('g')
        .attr('class', 'node')
        .attr('data-id', (d) => d.id)
        .attr('data-uuid', (d) => d.uuid);

      // movie nodes (circles)
      nodeEnter
        .filter((d): d is D3MovieNode => d.type === 'movie')
        .append('circle')
        .attr('r', 35)
        .attr('fill', '#FFC0CB') // pink
        .attr('fill-opacity', 0.7) // decreased opacity
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 5) // increased stroke width
        .attr('class', 'node-shape interactable draggable')
        .style('filter', 'url(#movie-drop-shadow)'); // apply drop shadow

      // actor nodes (circles)
      nodeEnter
        .filter((d): d is D3ActorNode => d.type === 'actor')
        .append('circle')
        .attr('r', 35)
        .attr('fill', '#FFA500') // orange
        .attr('fill-opacity', 0.7) // decreased opacity
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 5) // increased stroke width
        .attr('class', 'node-shape interactable draggable')
        .style('filter', 'url(#movie-drop-shadow)'); // apply drop shadow

      // director nodes (circles) - changed from ellipse for consistency
      nodeEnter
        .filter((d): d is D3DirectorNode => d.type === 'director')
        .append('circle')
        .attr('r', 35)
        .attr('fill', '#ADD8E6') // light blue
        .attr('fill-opacity', 0.7) // decreased opacity
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 5) // increased stroke width
        .attr('class', 'node-shape interactable draggable')
        .style('filter', 'url(#movie-drop-shadow)'); // apply drop shadow

      nodeEnter
        .append('text')
        .attr('dy', '.35em')
        .attr('font-size', '13px')
        .attr('fill', '#000000')
        .attr('text-anchor', 'middle')
        .text((d) =>
          d.name.length > 11 ? d.name.substring(0, 9) + '...' : d.name
        )
        .attr('opacity', 0)
        .attr('pointer-events', 'none');

      const nodeMerge = nodeEnter.merge(node);

      nodeMerge.attr(
        'transform',
        (d: D3Node) => `translate(${d.x || 0},${d.y || 0})`
      );

      // Update text opacity based on zoom level
      nodeMerge
        .select('text')
        .attr('opacity', transformRef.current.k >= 0.7 ? 1 : 0);

      const hoveredIds = (ySharedState.get('hoveredNodeIds') as string[]) || [];
      const allClickSelectedIds: string[] = [];
      yClientClickSelections.forEach((nodeIds: string[]) => {
        allClickSelectedIds.push(...nodeIds);
      });

      // link highlighting logic
      let linksToHighlight: D3Link[] = [];
      if (hoveredIds.length === 1) {
        linksToHighlight = findConnectedLinks(links, hoveredIds[0]);
      } else if (hoveredIds.length === 2) {
        // ensure we pass the full 'nodes' array if findShortestPath needs it for context,
        // though our current version only needs links and ids.
        linksToHighlight = findShortestPathForMovies(
          links,
          hoveredIds[0],
          hoveredIds[1]
        );
      }

      // apply link styles (default and highlighted)
      linkMerge
        .attr('stroke', (d) =>
          linksToHighlight.includes(d)
            ? HIGHLIGHTED_LINK_COLOR
            : d.type === 'directed'
              ? DIRECTED_LINK_COLOR
              : DEFAULT_LINK_COLOR
        )
        .attr('stroke-opacity', (d) =>
          linksToHighlight.includes(d)
            ? HIGHLIGHTED_LINK_OPACITY
            : DEFAULT_LINK_OPACITY
        )
        .attr('stroke-width', (d) =>
          linksToHighlight.includes(d)
            ? HIGHLIGHTED_LINK_STROKE_WIDTH
            : DEFAULT_LINK_STROKE_WIDTH
        )
        .attr('marker-end', 'url(#movie-arrowhead)');

      const allHighlightedIds = [
        ...new Set([...hoveredIds, ...allClickSelectedIds]),
      ];

      nodeMerge
        .select('.node-shape')
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 1.5);

      if (allHighlightedIds.length > 0) {
        if (hoveredIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => hoveredIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', '#ECC94B') // yellow hover
            .attr('stroke-width', HIGHLIGHTED_LINK_STROKE_WIDTH);
        }

        if (allClickSelectedIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => allClickSelectedIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', '#63B3ED') // blue select
            .attr('stroke-width', HIGHLIGHTED_LINK_STROKE_WIDTH);
        }

        const highlightedNodes = nodes.filter((n) =>
          allHighlightedIds.includes(n.id)
        );
        // if two nodes are hovered and a shortest path is highlighted, include a path summary
        if (hoveredIds.length === 2 && linksToHighlight.length > 0) {
          const startId = hoveredIds[0];
          const endId = hoveredIds[1];
          const startName = nodeMap.get(startId)?.name || startId;
          const endName = nodeMap.get(endId)?.name || endId;
          // reconstruct ordered node id sequence along the path
          const pathNodeIds: string[] = [startId];
          let currentId: string = startId;
          for (const link of linksToHighlight) {
            const nextId = getOtherEndOfLink(link, currentId);
            pathNodeIds.push(nextId);
            currentId = nextId;
          }
          const pathNodeNames = pathNodeIds.map(
            (id) => nodeMap.get(id)?.name || id
          );
          updateSelectedNodesInfo(highlightedNodes, {
            startName,
            endName,
            pathNodeNames,
          });
        } else {
          updateSelectedNodesInfo(highlightedNodes);
        }
      } else {
        updateSelectedNodesInfo([]);
      }

      const needsInitialLayout = nodes.some(
        (node) => node.x === fixedWidth / 2 && node.y === fixedHeight / 2
      );

      if (needsInitialLayout) {
        initializeLayout(nodes);
      }
    };

    // function to initialize layout
    const initializeLayout = (nodes: D3Node[]) => {
      console.log('initializing movie layout with force simulation');

      // get links based on the current nodes from mapNodesToD3
      // this is necessary because the `nodes` argument to initializeLayout
      // comes from mapNodesToD3, which itself is called within updateVisualization.
      // the links need to be mapped using these exact node objects for the simulation.
      const nodeMapForLinks = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMapForLinks.set(n.id, n));
      const links = mapLinksToD3(nodeMapForLinks);

      const availableWidth = fixedWidth - tooltipWidth;

      const simulation = d3
        .forceSimulation<D3Node>(nodes) // use the passed 'nodes' array which has initial default positions
        .force(
          'link',
          d3
            .forceLink<D3Node, D3Link>(links)
            .id((d) => d.id)
            .distance(80) // Increased link distance for more spacing
            .strength(0.1) // Decreased link strength for more spacing
        )
        .force('charge', d3.forceManyBody().strength(-600)) // Increased repulsion for more spacing
        .force(
          'center',
          d3.forceCenter(
            tooltipWidth, // Shifted center to the left
            fixedHeight / 2
          )
        )
        .force(
          'x',
          d3.forceX(tooltipWidth + availableWidth * 0.35).strength(0.03) // Shifted X force to the left
        )
        .force(
          'y',
          d3.forceY(fixedHeight / 2).strength(0.1) // Increased strength to make layout wider
        )
        .force('collision', d3.forceCollide<D3Node>().radius(55)) // Increased collision radius for more spacing
        .stop(); // stop() before manual ticking or batch ticking

      console.log('running movie simulation for 200 ticks for initial layout');
      // run simulation for 200 ticks synchronously
      simulation.tick(200);

      // sync with yjs after simulation. the 'nodes' array objects now have x,y properties updated by the simulation.
      doc!.transact(() => {
        nodes.forEach((node) => {
          // find the corresponding y.map for this node and update its x, y
          for (let i = 0; i < yNodes.length; i++) {
            const nodeMap = yNodes.get(i);
            if (nodeMap.get('id') === node.id) {
              if (node.x !== undefined && node.y !== undefined) {
                nodeMap.set('x', node.x);
                nodeMap.set('y', node.y);
              } else {
                // this case should ideally not happen if simulation runs correctly
                console.warn(`simulation did not set x/y for node ${node.id}`);
              }
              break;
            }
          }
        });
      });

      updateVisualization(); // redraw with new positions calculated by the simulation
    };

    updateVisualization();
    updateSelectedNodesInfo([]);

    const observer = () => {
      updateVisualization();
    };

    yNodes.observeDeep(observer);
    yLinks.observeDeep(observer);
    ySharedState.observe(observer);
    yClientClickSelections.observe(observer);

    if (ySharedState.get('zoomScale') === undefined) {
      doc!.transact(() => {
        ySharedState.set('zoomScale', 1);
        ySharedState.set('panX', 0);
        ySharedState.set('panY', 0);
      });
    }

    return () => {
      yNodes.unobserveDeep(observer);
      yLinks.unobserveDeep(observer);
      ySharedState.unobserve(observer);
      yClientClickSelections.unobserve(observer);
      if (parent) {
        parent.removeEventListener('interaction', ((
          e: CustomEvent<InteractionEvent>
        ) => handleInteraction(e.detail)) as EventListener);
      }
    };
  }, [
    syncStatus,
    doc,
    yNodes,
    yLinks,
    ySharedState,
    userId,
    yClientClickSelections,
    tooltipWidth,
  ]);

  if (!syncStatus) {
    return (
      <div
        style={{
          width: fixedWidth,
          height: fixedHeight,
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'transparent', // ensure this is transparent
          overflow: 'hidden',
          borderRadius: '8px',
          boxShadow: 'inset 0 0 10px rgba(0,0,0,0.05)', // matched senate.tsx
        }}
      >
        <div // inner content with some background for text readability
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '2rem',
            maxWidth: '600px',
            background: 'rgba(255,255,255,0.8)', // matched senate.tsx
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)', // matched senate.tsx
            color: '#333', // matched senate.tsx (implicitly by senate having #333 and #555)
          }}
        >
          <div
            style={{
              fontSize: '2rem',
              marginBottom: '0.5rem',
              fontWeight: 500,
              color: '#333', // matched senate.tsx
            }}
          >
            movie graph visualization
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              marginBottom: '1.5rem',
              color: '#555', // matched senate.tsx
            }}
          >
            waiting for synchronization...
          </div>
          <div
            style={{
              marginTop: '1rem',
              width: '100%',
              height: '6px',
              background: '#eee', // matched senate.tsx
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '40%',
                height: '100%',
                background: `linear-gradient(to right, #2980b9, #2980b9)`, // matched senate.tsx progress bar
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
    <div
      style={{
        width: fixedWidth,
        height: fixedHeight,
        position: 'relative',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div ref={d3Container} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default Movies;
