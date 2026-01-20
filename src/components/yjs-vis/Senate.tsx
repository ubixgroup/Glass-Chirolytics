import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '@/context/YjsContext';
import * as d3 from 'd3';
import senators117Data from '@/assets/senatedata/fakesenate.json';
import { InteractionEvent, InteractionPoint } from '@/types/interactionTypes';
import { GetCurrentTransformFn } from '@/utils/interactionHandlers';

// senate visualization using real 117th congress voting data
// visualizes how senators voted on bills instead of sponsor/cosponsor relationships

// data structure types for senate data
interface Senator {
  icpsr: number;
  id: string;
  name: string;
  state: string;
  party: string;
  party_code: number;
  faction: string;
  ideoscore: number;
}

// type for senators from s117.json
interface S117Senator {
  congress: number;
  icpsr: number;
  state_icpsr: number;
  state_abbrev: string;
  senclass: number;
  party_code: number;
  bioname: string;
  ideoscore: number;
}

interface Vote {
  first_name: string;
  last_name: string;
  party_short_name: string;
  icpsr: number;
  vote: string; // "Yea", "Nay", "Abs", etc.
}

interface VotingData {
  party_vote_counts: Record<string, Record<string, number>>;
  vote_title: string;
  summary: string;
  bill_number: string;
  id: string;
  votes: Vote[];
}

interface ProcessedNode {
  id: string;
  name: string;
  type: 'senator' | 'bill';
  party?: string;
  state?: string;
  faction?: string;
  ideoscore?: number;
  summary?: string;
  bill_number?: string;
}

interface ProcessedLink {
  source: string;
  target: string;
  type: string; // "yea", "nay", "abs"
  vote?: string;
}

interface ProcessedData {
  nodes: ProcessedNode[];
  links: ProcessedLink[];
}

// function to dynamically import voting data
async function loadVotingData(billId: string): Promise<VotingData | null> {
  try {
    // dynamically import the voting data file
    const votingModule = await import(
      `@/assets/senatedata/fake_votes/${billId}.json`
    );
    return votingModule.default as VotingData;
  } catch (error) {
    console.error(`failed to load voting data for ${billId}:`, error);
    return null;
  }
}

// function to determine faction based on ideology score
function getFactionFromIdeology(ideoscore: number, partyCode: number): string {
  // independents caucus with democrats, so treat them as democrats
  const isDemocratic = partyCode === 100 || partyCode === 328;

  if (isDemocratic) {
    if (ideoscore >= 0.0 && ideoscore <= 0.11) return 'progressive';
    if (ideoscore >= 0.12 && ideoscore <= 0.29) return 'liberal';
    if (ideoscore >= 0.3 && ideoscore <= 0.55) return 'moderate-dem';
  } else if (partyCode === 200) {
    if (ideoscore >= 0.45 && ideoscore <= 0.6) return 'moderate-rep';
    if (ideoscore >= 0.61 && ideoscore <= 0.75)
      return 'mainstream-conservative';
    if (ideoscore >= 0.76 && ideoscore <= 1.0) return 'national-conservative';
  }

  // fallback for edge cases
  return partyCode === 200 ? 'mainstream-conservative' : 'liberal';
}

// function to get faction color
function getFactionColor(faction: string): string {
  switch (faction) {
    // democratic factions (shades of blue)
    case 'progressive':
      return 'rgba(30, 64, 175, 0.9)'; // dark blue
    case 'liberal':
      return 'rgba(59, 130, 246, 0.9)'; // medium blue
    case 'moderate-dem':
      return 'rgba(147, 197, 253, 0.9)'; // light blue

    // republican factions (shades of red)
    case 'moderate-rep':
      return 'rgba(252, 165, 165, 0.9)'; // light red
    case 'mainstream-conservative':
      return 'rgba(239, 68, 68, 0.9)'; // medium red
    case 'national-conservative':
      return 'rgba(185, 28, 28, 0.9)'; // dark red

    default:
      return 'rgba(107, 114, 128, 0.9)'; // gray fallback
  }
}

// function to convert s117 senator data to internal format
function convertS117Senator(s117Senator: S117Senator): Senator {
  // extract first and last name from bioname (format: "Last, First")
  const nameParts = s117Senator.bioname.split(', ');
  const lastName = nameParts[0] || '';
  const firstName = nameParts[1] || '';
  const fullName = `${firstName} ${lastName}`.trim();

  // use icpsr as stable internal id for senators (string form for consistency)
  const id = String(s117Senator.icpsr);

  // convert party code to party name
  let party = 'independent';
  if (s117Senator.party_code === 100) {
    party = 'democrat';
  } else if (s117Senator.party_code === 200) {
    party = 'republican';
  } else if (s117Senator.party_code === 328) {
    party = 'independent';
  }

  // determine faction based on ideology score
  const faction = getFactionFromIdeology(
    s117Senator.ideoscore,
    s117Senator.party_code
  );

  return {
    icpsr: s117Senator.icpsr,
    id,
    name: fullName,
    state: s117Senator.state_abbrev,
    party,
    party_code: s117Senator.party_code,
    faction, // add faction to senator data
    ideoscore: s117Senator.ideoscore, // include ideology score
  };
}

// function to get available bills from the s117_votes directory
function getAvailableBills(): string[] {
  // hardcoded list of available bills - in a real app this could be dynamic
  return [
    'hr1319',
    'hr3684',
    'hr5376',
    'hr4346',
    'hr8404',
    's2747',
    's2938',
    's3373',
    'hres24',
    'pn1783',
  ];
}

// function to process data for visualization
async function processSenateData(
  selectedBills: string[] = getAvailableBills() // default to all available bills
): Promise<ProcessedData> {
  const nodes: ProcessedNode[] = [];
  const links: ProcessedLink[] = [];

  // convert s117 senator data to internal format
  const senators = senators117Data.map(convertS117Senator);

  // create a map of icpsr to senator for quick lookup
  const senatorMap = new Map<number, Senator>();
  senators.forEach((senator) => {
    senatorMap.set(senator.icpsr, senator);
  });

  // add all senators as nodes
  senators.forEach((senator) => {
    nodes.push({
      id: senator.id,
      name: senator.name,
      type: 'senator',
      party: senator.party,
      state: senator.state,
      faction: senator.faction,
      ideoscore: senator.ideoscore,
    });
  });

  // process selected bills
  for (const billId of selectedBills) {
    // load voting data to get bill information
    const votingData = await loadVotingData(billId);
    if (!votingData) {
      console.warn(`voting data not found for ${billId}`);
      continue;
    }

    // add bill as node using data from voting file
    nodes.push({
      id: billId,
      name: votingData.vote_title,
      type: 'bill',
      summary: votingData.summary,
      bill_number: votingData.bill_number,
    });

    // create links based on votes
    votingData.votes.forEach((vote) => {
      const senator = senatorMap.get(vote.icpsr);
      if (!senator) {
        console.warn(`senator not found for icpsr ${vote.icpsr}`);
        return;
      }

      // create link from senator to bill based on vote
      let linkType = 'vote';
      if (vote.vote === 'Yea') {
        linkType = 'yea';
      } else if (vote.vote === 'Nay') {
        linkType = 'nay';
      } else if (vote.vote === 'Abs') {
        linkType = 'abstain';
      } else {
        linkType = 'other';
      }

      links.push({
        source: senator.id,
        target: billId,
        type: linkType,
        vote: vote.vote,
      });
    });
  }

  return { nodes, links };
}

// define shared value types for y.map
type NodeMapValue = string | number | boolean | undefined;
type LinkMapValue = string;

// d3 specific types - extend SimulationNodeDatum with our required properties
interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  type: string;
  name: string;
  party?: string;
  state?: string;
  status?: string;
  uuid: string;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  type: string;
}

// props interface for the Senate component
interface SenateProps {
  getCurrentTransformRef: React.MutableRefObject<GetCurrentTransformFn | null>;
}

// helper function to compact/prune the yjs document
function pruneYDoc(doc: Y.Doc) {
  console.log('[Yjs] Running document compaction...');
  const beforeSize = Y.encodeStateAsUpdate(doc).byteLength;

  try {
    // create a new temporary document
    const tempDoc = new Y.Doc();

    // get current data from original doc
    const originalNodes = doc.getArray<Y.Map<NodeMapValue>>('senateNodes');
    const originalLinks = doc.getArray<Y.Map<LinkMapValue>>('senateLinks');
    const originalSharedState = doc.getMap<string | boolean | null>(
      'senateSharedState'
    );

    // get references to collections in temp doc
    const tempNodes = tempDoc.getArray<Y.Map<NodeMapValue>>('senateNodes');
    const tempLinks = tempDoc.getArray<Y.Map<LinkMapValue>>('senateLinks');
    const tempSharedState = tempDoc.getMap<string | boolean | null>(
      'senateSharedState'
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
        (value: string | boolean | null, key: string) => {
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
      originalSharedState.forEach((_: string | boolean | null, key: string) =>
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
      `[Yjs] Compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
    );

    // cleanup temporary doc
    tempDoc.destroy();
  } catch (err) {
    console.error('[Yjs] Compaction failed:', err);

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
        `[Yjs] Simple compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
      );
    } catch (fallbackErr) {
      console.error('[Yjs] Fallback compaction also failed:', fallbackErr);
    }
  }
}

const Senate: React.FC<SenateProps> = ({ getCurrentTransformRef }) => {
  // get doc from context (no awareness)
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;

  // reference to the d3 container
  const d3Container = useRef<HTMLDivElement | null>(null);

  // setup yjs shared arrays
  const yNodes = doc!.getArray<Y.Map<NodeMapValue>>('senateNodes');
  const yLinks = doc!.getArray<Y.Map<LinkMapValue>>('senateLinks');

  // add shared state with yjs
  const ySharedState = doc!.getMap<string | boolean | null | string[] | number>(
    'senateSharedState'
  );

  // add separate hover tracking for left and right hands
  const yHoveredNodeIdsLeft = doc!.getArray<string>('senateHoveredNodeIdsLeft');
  const yHoveredNodeIdsRight = doc!.getArray<string>(
    'senateHoveredNodeIdsRight'
  );

  // add client click selections map - maps userId to array of selected node ids
  const yClientClickSelections = doc!.getMap<string[]>('clientClickSelections');

  // reference to track initialization
  const isInitializedRef = useRef(false);

  // track current transform for gestures
  const [currentTransform, setCurrentTransform] = useState<d3.ZoomTransform>(
    d3.zoomIdentity
  );
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
  const tooltipWidth = fixedWidth * 0.25;

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
      console.log('assuming sync after timeout for senate visualization');
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
      console.log(`[Yjs] Document size: ${byteLength} bytes`);
    }, 60000); // every 60 seconds

    // monitor DOM elements
    const domMonitor = setInterval(() => {
      const nodeCount = document.querySelectorAll('g.node').length;
      const tooltipCount = document.querySelectorAll('g.tooltip').length;
      console.log(`[DOM] ${nodeCount} nodes, ${tooltipCount} tooltips in DOM`);
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

  // initialize graph data from real senate data if ynodes is empty after sync
  useEffect(() => {
    // wait for sync and check if nodes are empty
    if (!syncStatus || yNodes.length > 0) {
      return;
    }

    console.log(
      'initializing senate graph data from 117th congress - loading all available bills from s117_votes directory'
    );

    const initializeData = async () => {
      try {
        // process real senate data - include all available bills from 117th congress
        const processedData = await processSenateData();

        const initialNodes: Y.Map<NodeMapValue>[] = [];
        const initialLinks: Y.Map<LinkMapValue>[] = [];

        // we'll set positions later with d3 layout
        const defaultX = fixedWidth / 2;
        const defaultY = fixedHeight / 2;

        // process nodes from processed data
        processedData.nodes.forEach((node) => {
          const yNode = new Y.Map<NodeMapValue>();
          yNode.set('id', node.id);
          yNode.set('name', node.name);
          yNode.set('type', node.type);
          // just set initial positions - d3 will update these
          yNode.set('x', defaultX);
          yNode.set('y', defaultY);
          yNode.set('uuid', crypto.randomUUID()); // stable react key

          if (node.type === 'senator') {
            // normalize party names to lowercase
            let party = 'i'; // default independent
            if (node.party === 'democrat') {
              party = 'd';
            } else if (node.party === 'republican') {
              party = 'r';
            } else if (node.party === 'independent') {
              party = 'i';
            }
            yNode.set('party', party);
            yNode.set('state', node.state);
            yNode.set('faction', node.faction);
            yNode.set('ideoscore', node.ideoscore);
          } else if (node.type === 'bill') {
            yNode.set('summary', node.summary);
            yNode.set('bill_number', node.bill_number);
          }
          initialNodes.push(yNode);
        });

        // process links from processed data
        processedData.links.forEach((link) => {
          const yLink = new Y.Map<LinkMapValue>();
          yLink.set('source', link.source);
          yLink.set('target', link.target);
          yLink.set('type', link.type);
          if (link.vote) {
            yLink.set('vote', link.vote);
          }
          initialLinks.push(yLink);
        });

        // use transaction to batch updates
        doc!.transact(() => {
          yNodes.push(initialNodes);
          yLinks.push(initialLinks);
        });

        console.log(
          `loaded ${initialNodes.length} nodes and ${initialLinks.length} links from real senate data`
        );
      } catch (error) {
        console.error('failed to initialize senate data:', error);
      }
    };

    initializeData();
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
    setCurrentTransform(
      d3.zoomIdentity
        .translate(initialTransform.x, initialTransform.y)
        .scale(initialTransform.k)
    );

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
        setCurrentTransform(d3.zoomIdentity.translate(x, y).scale(scale));

        // apply transform to root if it exists
        const root = d3.select('#senate-root');
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

    // Only initialize once
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    console.log('initializing d3 visualization');

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
      .attr('id', 'senate-root')
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

    // Create a custom event handler for gesture interactions
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

          // find the Y.Map for this node
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
          // Handle hover events (from handleOne or handleGrabbing)
          const element = event.element;

          if (!element || !(element instanceof SVGElement)) return;

          // Get data from the element if it's a node
          if (
            (element.tagName === 'circle' || element.tagName === 'rect') &&
            element.classList.contains('node-shape')
          ) {
            // find the parent node group element that contains the data-id
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id');
            const handedness = event.handedness;

            if (nodeId && handedness) {
              // get the appropriate hover array based on handedness
              const targetHoverArray =
                handedness === 'left'
                  ? yHoveredNodeIdsLeft
                  : yHoveredNodeIdsRight;

              // add this node if not already in the list for this hand
              if (!targetHoverArray.toArray().includes(nodeId)) {
                targetHoverArray.push([nodeId]);
                updateVisualization();
              }
            }
          }
          break;
        }

        case 'pointerout': {
          // Handle hover end events (from handleOne or handleGrabbing)
          const element = event.element;
          if (!element || !(element instanceof SVGElement)) return;

          // If this is a node, remove only this specific node ID from the appropriate hovered list
          if (
            (element.tagName === 'circle' || element.tagName === 'rect') &&
            element.classList.contains('node-shape')
          ) {
            // find the parent node group element that contains the data-id
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id');
            const handedness = event.handedness;

            if (nodeId && handedness) {
              // get the appropriate hover array based on handedness
              const targetHoverArray =
                handedness === 'left'
                  ? yHoveredNodeIdsLeft
                  : yHoveredNodeIdsRight;

              // find and remove this node from the appropriate hand's hover list
              const currentArray = targetHoverArray.toArray();
              const index = currentArray.indexOf(nodeId);
              if (index > -1) {
                targetHoverArray.delete(index, 1);
                updateVisualization();
              }
            }
          }
          break;
        }

        case 'pointerselect': {
          // Handle selection events (from handleThumbIndex)
          const element = event.element;
          if (!element || !(element instanceof SVGElement)) return;

          if (element.classList.contains('node-shape')) {
            // find the parent node group element that contains the data-id
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id');
            const handedness = event.handedness;

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
                // add node to selections and remove from hover state
                yClientClickSelections.set(userId, [
                  ...currentSelections,
                  nodeId,
                ]);

                // remove from hover state when selected
                if (handedness) {
                  const targetHoverArray =
                    handedness === 'left'
                      ? yHoveredNodeIdsLeft
                      : yHoveredNodeIdsRight;

                  const currentArray = targetHoverArray.toArray();
                  const index = currentArray.indexOf(nodeId);
                  if (index > -1) {
                    targetHoverArray.delete(index, 1);
                  }
                }
              }
              updateVisualization();
            }
          }
          break;
        }

        case 'drag': {
          // Handle drag events for panning
          if (event.transform) {
            const transform = event.transform as {
              x: number;
              y: number;
              scale?: number;
            };
            const { x, y } = transform;
            const scale = transform.scale || currentTransform.k;

            // update shared transform via yjs
            doc!.transact(() => {
              ySharedState.set('panX', x);
              ySharedState.set('panY', y);
              ySharedState.set('zoomScale', scale);
            });

            // Update current transform state
            const newTransform = d3.zoomIdentity.translate(x, y).scale(scale);
            setCurrentTransform(newTransform);

            // Apply the transform to the root group
            root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
          }
          break;
        }

        case 'zoom': {
          // Handle zoom events
          if (event.transform) {
            const { x, y, scale } = event.transform;

            // update shared transform via yjs
            doc!.transact(() => {
              ySharedState.set('panX', x);
              ySharedState.set('panY', y);
              ySharedState.set('zoomScale', scale);
            });

            // Update current transform state
            const newTransform = d3.zoomIdentity.translate(x, y).scale(scale);
            setCurrentTransform(newTransform);

            // Apply the transform to the root group
            root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
          }
          break;
        }
      }
    };

    // Add event listener for custom interaction events
    const parent = d3Container.current?.parentElement;
    if (parent) {
      parent.addEventListener('interaction', ((
        e: CustomEvent<InteractionEvent>
      ) => handleInteraction(e.detail)) as EventListener);
    }

    // create tooltip group with modern styling
    const tooltip = svg
      .append('g')
      .attr('class', 'tooltip')
      .attr('transform', 'translate(0,0)');

    // add gradient for tooltip
    const tooltipGradient = svg.append('defs').append('linearGradient');

    tooltipGradient
      .attr('id', 'tooltip-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    tooltipGradient
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#1a202c')
      .attr('stop-opacity', 0.98);

    tooltipGradient
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#171923')
      .attr('stop-opacity', 0.98);

    tooltip
      .append('rect')
      .attr('width', tooltipWidth)
      .attr('height', fixedHeight)
      .attr('fill', 'url(#tooltip-gradient)')
      .attr('rx', 0)
      .attr('ry', 0);

    // add right-side rounded corners using a clip path
    const clipPath = svg
      .append('defs')
      .append('clipPath')
      .attr('id', 'tooltip-clip');
    clipPath
      .append('path')
      .attr(
        'd',
        `M 0,0 L ${tooltipWidth - 12},0 Q ${tooltipWidth},0 ${tooltipWidth},12 L ${tooltipWidth},${fixedHeight - 12} Q ${tooltipWidth},${fixedHeight} ${tooltipWidth - 12},${fixedHeight} L 0,${fixedHeight} Z`
      );

    tooltip.attr('clip-path', 'url(#tooltip-clip)');

    // tooltip content container - simplified approach
    const tooltipContent = tooltip
      .append('g')
      .attr('transform', `translate(20, 20)`);

    // helper function to convert node maps to d3 nodes
    const mapNodesToD3 = (): D3Node[] => {
      const nodes: D3Node[] = [];
      for (let i = 0; i < yNodes.length; i++) {
        const node = yNodes.get(i);
        const id = node.get('id') as string;
        const type = node.get('type') as string;
        const name = node.get('name') as string;
        const x = (node.get('x') as number) || fixedWidth / 2;
        const y = (node.get('y') as number) || fixedHeight / 2;
        const uuid = node.get('uuid') as string;

        const d3Node: D3Node = {
          id,
          type,
          name,
          x,
          y,
          uuid,
        };

        if (type === 'senator') {
          d3Node.party = node.get('party') as string;
          d3Node.state = node.get('state') as string;
        } else if (type === 'bill') {
          d3Node.status = node.get('status') as string;
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
        const type = link.get('type') as string;

        const source = nodeMap.get(sourceId) || sourceId;
        const target = nodeMap.get(targetId) || targetId;

        links.push({ source, target, type });
      }
      return links;
    };

    // function to update tooltip content for two-hand hover scenarios
    const updateTwoHandHoverInfo = async (
      leftNode: D3Node | undefined,
      rightNode: D3Node | undefined,
      nodeMap?: Map<string, D3Node>,
      links?: D3Link[]
    ) => {
      if (!leftNode || !rightNode) return;

      // clear all existing content
      tooltipContent.selectAll('*').remove();

      // function to wrap text with proper line breaks
      const wrapText = (text: string, charLimit: number): string[] => {
        const words = text.split(/\s+/);
        const lines: string[] = [];
        let line = '';

        for (const word of words) {
          const testLine = line + (line ? ' ' : '') + word;
          if (testLine.length > charLimit) {
            if (line) {
              lines.push(line);
              line = word;
            } else {
              // if single word is longer than limit, just add it
              lines.push(word);
            }
          } else {
            line = testLine;
          }
        }

        if (line) {
          lines.push(line);
        }

        return lines;
      };

      // helper function to render title
      const renderTitle = (text: string, startY: number): number => {
        const wrappedLines = wrapText(text, 22);
        const lineHeight = 30;

        wrappedLines.forEach((line, index) => {
          tooltipContent
            .append('text')
            .attr('x', 0)
            .attr('y', startY + index * lineHeight)
            .attr('font-size', '26px')
            .attr('fill', '#ffffff')
            .attr('font-weight', 'bold')
            .text(line);
        });

        return startY + wrappedLines.length * lineHeight + 15; // extra spacing after title
      };

      // helper function to render subtitle
      const renderSubtext = (text: string, startY: number): number => {
        const wrappedLines = wrapText(text, 28);
        const lineHeight = 25;

        wrappedLines.forEach((line, index) => {
          tooltipContent
            .append('text')
            .attr('x', 0)
            .attr('y', startY + index * lineHeight)
            .attr('font-size', '20px')
            .attr('fill', '#cbd5e0')
            .attr('font-weight', 'normal')
            .text(line);
        });

        return startY + wrappedLines.length * lineHeight + 10; // spacing after subtext
      };

      let currentY = 20; // start position

      if (leftNode.type === 'senator' && rightNode.type === 'senator') {
        // senator-senator comparison
        currentY = renderTitle(
          `${leftNode.name} vs ${rightNode.name}`,
          currentY
        );

        if (nodeMap && links) {
          // find bills both senators voted on
          const leftVotes = new Map<string, string>(); // billId -> vote type
          const rightVotes = new Map<string, string>(); // billId -> vote type

          // collect left senator's votes
          links.forEach((link) => {
            const source = link.source as D3Node;
            const target = link.target as D3Node;
            if (source.id === leftNode.id && target.type === 'bill') {
              leftVotes.set(target.id, link.type);
            }
          });

          // collect right senator's votes
          links.forEach((link) => {
            const source = link.source as D3Node;
            const target = link.target as D3Node;
            if (source.id === rightNode.id && target.type === 'bill') {
              rightVotes.set(target.id, link.type);
            }
          });

          // find bills they both voted on
          const commonBills = new Set<string>();
          leftVotes.forEach((_, billId) => {
            if (rightVotes.has(billId)) {
              commonBills.add(billId);
            }
          });

          // categorize agreements and disagreements
          const agreements: string[] = [];
          const disagreements: string[] = [];

          commonBills.forEach((billId) => {
            const leftVote = leftVotes.get(billId);
            const rightVote = rightVotes.get(billId);
            const billNode = nodeMap.get(billId);

            if (billNode && leftVote && rightVote) {
              if (leftVote === rightVote) {
                agreements.push(billNode.name);
              } else {
                // only count as disagreement if both actually voted (not abstained)
                if (leftVote !== 'abstain' && rightVote !== 'abstain') {
                  disagreements.push(billNode.name);
                }
              }
            }
          });

          currentY = renderSubtext(
            `Bills in common: ${commonBills.size}`,
            currentY
          );

          if (agreements.length > 0) {
            currentY = renderSubtext('Voted the same:', currentY);
            agreements.slice(0, 5).forEach((billName) => {
              currentY = renderSubtext(`• ${billName}`, currentY);
            });
            if (agreements.length > 5) {
              currentY = renderSubtext(
                `and ${agreements.length - 5} more...`,
                currentY
              );
            }
          }

          if (disagreements.length > 0) {
            currentY = renderSubtext('Voted differently:', currentY);
            disagreements.slice(0, 5).forEach((billName) => {
              currentY = renderSubtext(`• ${billName}`, currentY);
            });
            if (disagreements.length > 5) {
              currentY = renderSubtext(
                `and ${disagreements.length - 5} more...`,
                currentY
              );
            }
          }
        }
      } else if (
        (leftNode.type === 'senator' && rightNode.type === 'bill') ||
        (leftNode.type === 'bill' && rightNode.type === 'senator')
      ) {
        // senator-bill interaction
        const senator = leftNode.type === 'senator' ? leftNode : rightNode;
        const bill = leftNode.type === 'bill' ? leftNode : rightNode;

        if (links) {
          // find the vote relationship
          const voteLink = links.find((link) => {
            const source = link.source as D3Node;
            const target = link.target as D3Node;
            return (
              (source.id === senator.id && target.id === bill.id) ||
              (source.id === bill.id && target.id === senator.id)
            );
          });

          if (voteLink) {
            let voteChoice = '';
            if (voteLink.type === 'yea') {
              voteChoice = 'yea';
            } else if (voteLink.type === 'nay') {
              voteChoice = 'nay';
            } else if (voteLink.type === 'abstain') {
              voteChoice = 'abstained';
            } else {
              voteChoice = 'did not vote';
            }
            const voteText = `${senator.name} voted ${voteChoice} on ${bill.name}`;
            currentY = renderTitle(voteText, currentY);
          } else {
            const voteText = `${senator.name} - no vote recorded on ${bill.name}`;
            currentY = renderTitle(voteText, currentY);
          }
        } else {
          const voteText = `${senator.name} on ${bill.name}`;
          currentY = renderTitle(voteText, currentY);
        }
      }
    };

    // function to update the tooltip content with clean styling
    const updateSelectedNodesInfo = async (
      nodes: D3Node[] | D3Node | null,
      nodeMap?: Map<string, D3Node>,
      links?: D3Link[]
    ) => {
      // Convert single node to array or use empty array if null
      const nodesArray = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];

      // Clear all existing content
      tooltipContent.selectAll('*').remove();

      // function to wrap text with proper line breaks
      const wrapText = (text: string, charLimit: number): string[] => {
        const words = text.split(/\s+/);
        const lines: string[] = [];
        let line = '';

        for (const word of words) {
          const testLine = line + (line ? ' ' : '') + word;
          if (testLine.length > charLimit) {
            if (line) {
              lines.push(line);
              line = word;
            } else {
              // if single word is longer than limit, just add it
              lines.push(word);
            }
          } else {
            line = testLine;
          }
        }

        if (line) {
          lines.push(line);
        }

        return lines;
      };

      // helper function to render title
      const renderTitle = (text: string, startY: number): number => {
        const wrappedLines = wrapText(text, 22);
        const lineHeight = 30;

        wrappedLines.forEach((line, index) => {
          tooltipContent
            .append('text')
            .attr('x', 0)
            .attr('y', startY + index * lineHeight)
            .attr('font-size', '26px')
            .attr('fill', '#ffffff')
            .attr('font-weight', 'bold')
            .text(line);
        });

        return startY + wrappedLines.length * lineHeight + 15; // extra spacing after title
      };

      // helper function to render subtitle
      const renderSubtext = (text: string, startY: number): number => {
        const wrappedLines = wrapText(text, 28);
        const lineHeight = 25;

        wrappedLines.forEach((line, index) => {
          tooltipContent
            .append('text')
            .attr('x', 0)
            .attr('y', startY + index * lineHeight)
            .attr('font-size', '20px')
            .attr('fill', '#cbd5e0')
            .attr('font-weight', 'normal')
            .text(line);
        });

        return startY + wrappedLines.length * lineHeight + 10; // spacing after subtext
      };

      let currentY = 20; // start position

      if (nodesArray.length === 0) {
        // default state
        currentY = renderTitle('Senate voting visualizer', currentY);
        currentY = renderSubtext(
          'Hover over senators & bills to see votes (sample data)',
          currentY
        );
      } else if (nodesArray.length === 1) {
        // single node selected
        const node = nodesArray[0];
        currentY = renderTitle(node.name, currentY);

        if (node.type === 'senator') {
          // get party and ideology info from yjs data
          let ideoscore = 0;
          let party = 'd';
          let state = '';

          for (let i = 0; i < yNodes.length; i++) {
            const nodeMap = yNodes.get(i);
            if (nodeMap.get('id') === node.id) {
              ideoscore = (nodeMap.get('ideoscore') as number) || 0;
              party = (nodeMap.get('party') as string) || 'd';
              state = (nodeMap.get('state') as string) || '';
              break;
            }
          }

          // format party name properly
          let partyName = 'Independent';
          if (party === 'd') {
            partyName = 'Blue Party';
          } else if (party === 'r') {
            partyName = 'Red Party';
          }

          currentY = renderSubtext(
            `${partyName} Senator from ${state}`,
            currentY
          );
          currentY = renderSubtext(
            `Ideology Score: ${ideoscore.toFixed(2)}`,
            currentY
          );

          // get voting records for this senator from existing links
          const votedFor: string[] = [];
          const votedAgainst: string[] = [];

          // get current links data (only if nodeMap and links are provided)
          if (nodeMap && links) {
            // find all links where this senator is the source
            const senatorLinks = links.filter((link) => {
              const source = link.source as D3Node;
              return source.id === node.id;
            });

            // organize votes by type and get bill names
            senatorLinks.forEach((link) => {
              const target = link.target as D3Node;
              if (target.type === 'bill') {
                if (link.type === 'yea') {
                  votedFor.push(target.name);
                } else if (link.type === 'nay') {
                  votedAgainst.push(target.name);
                }
                // abstentions are ignored as requested
              }
            });
          }

          // render voting lists
          if (votedFor.length > 0) {
            currentY = renderSubtext('Voted For:', currentY);
            votedFor.forEach((title) => {
              currentY = renderSubtext(`• ${title}`, currentY);
            });
          }

          if (votedAgainst.length > 0) {
            currentY = renderSubtext('Voted Against:', currentY);
            votedAgainst.forEach((title) => {
              currentY = renderSubtext(`• ${title}`, currentY);
            });
          }
        } else if (node.type === 'bill') {
          // get additional bill info from yjs data and voting data
          let billNumber = '';
          let summary = '';
          let voteTitle = '';
          let totalVotes = 0;

          // get basic bill info from yjs
          for (let i = 0; i < yNodes.length; i++) {
            const nodeMap = yNodes.get(i);
            if (nodeMap.get('id') === node.id) {
              billNumber = (nodeMap.get('bill_number') as string) || '';
              summary = (nodeMap.get('summary') as string) || '';
              break;
            }
          }

          // get voting data to extract vote_title and vote counts
          let yeaCount = 0;
          let nayCount = 0;
          let absCount = 0;

          try {
            const votingData = await loadVotingData(node.id);
            if (votingData) {
              voteTitle = votingData.vote_title || '';

              // calculate vote counts by type from party_vote_counts
              if (votingData.party_vote_counts) {
                Object.values(votingData.party_vote_counts).forEach(
                  (partyCounts) => {
                    if (partyCounts.Yea) yeaCount += partyCounts.Yea;
                    if (partyCounts.Nay) nayCount += partyCounts.Nay;
                    if (partyCounts.Abs) absCount += partyCounts.Abs;
                  }
                );
                totalVotes = yeaCount + nayCount + absCount;
              }
            }
          } catch (error) {
            console.error(
              `failed to load voting data for vote count: ${error}`
            );
          }

          // use vote_title if available, otherwise fall back to node name
          const displayTitle = voteTitle || node.name;

          // update the title with the vote_title
          tooltipContent.selectAll('*').remove();
          currentY = 20;
          currentY = renderTitle(displayTitle, currentY);

          currentY = renderSubtext(`Bill Number: ${billNumber}`, currentY);
          currentY = renderSubtext(`Total Votes: ${totalVotes}`, currentY);
          currentY = renderSubtext(`Yea: ${yeaCount}`, currentY);
          currentY = renderSubtext(`Nay: ${nayCount}`, currentY);
          currentY = renderSubtext(`Abstention: ${absCount}`, currentY);
          currentY = renderSubtext(`Bill Summary: ${summary}`, currentY);
        }
      } else {
        // multiple nodes selected
        currentY = renderTitle(`${nodesArray.length} nodes selected`, currentY);

        // show up to 5 node names
        const maxToShow = 5;
        const namesToShow = nodesArray.slice(0, maxToShow);
        const additionalCount = nodesArray.length - maxToShow;

        namesToShow.forEach((node) => {
          currentY = renderSubtext(`• ${node.name}`, currentY);
        });

        if (additionalCount > 0) {
          renderSubtext(`and ${additionalCount} more...`, currentY);
        }
      }
    };

    // function to update the visualization
    const updateVisualization = () => {
      // get current data
      const nodes = mapNodesToD3();

      // create a node map for resolving links
      const nodeMap = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMap.set(n.id, n));

      // resolve links
      const links = mapLinksToD3(nodeMap);

      // create a key function for links
      const linkKeyFn = (d: D3Link): string => {
        const source = d.source as D3Node;
        const target = d.target as D3Node;
        return `${source.id}-${target.id}-${d.type}`;
      };

      // update links
      const link = linkGroup
        .selectAll<SVGLineElement, D3Link>('line')
        .data(links, linkKeyFn);

      // handle removed links
      link.exit().remove();

      // handle new links
      const linkEnter = link
        .enter()
        .append('line')
        .attr('stroke', (d) => {
          // color links based on vote type with 0.9 transparency
          if (d.type === 'yea') return 'rgba(46, 204, 113, 0.9)'; // green for yea votes
          if (d.type === 'nay') return 'rgba(231, 76, 60, 0.9)'; // red for nay votes
          if (d.type === 'abstain') return 'rgba(243, 156, 18, 0.9)'; // orange for abstentions
          return 'rgba(149, 165, 166, 0.9)'; // gray for other/unknown
        })
        .attr('stroke-width', (d) => {
          // make yea/nay votes more prominent with bigger width
          if (d.type === 'yea' || d.type === 'nay') return 4; // increased from 2 to 4
          return 2; // increased from 1 to 2
        })
        .attr(
          'stroke-dasharray',
          (d) => (d.type === 'abstain' ? '8,8' : 'none') // bigger dash pattern for abstentions
        )
        .attr('opacity', 0); // hidden by default

      // merge links
      const linkMerge = linkEnter.merge(link);

      // update link positions
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

      // update nodes
      const node = nodeGroup
        .selectAll<SVGGElement, D3Node>('g.node')
        .data(nodes, (d: D3Node) => d.uuid);

      // handle removed nodes
      node.exit().remove();

      // handle new nodes
      const nodeEnter = node
        .enter()
        .append('g')
        .attr('class', 'node')
        .attr('data-id', (d) => d.id)
        .attr('data-uuid', (d) => d.uuid);

      // create senator nodes with larger radius
      nodeEnter
        .filter((d) => d.type === 'senator')
        .append('circle')
        .attr('r', 20) // increased from 15 to 20
        .attr('fill', (d) => {
          // get faction from yjs data
          let faction = 'liberal'; // default
          for (let i = 0; i < yNodes.length; i++) {
            const nodeMap = yNodes.get(i);
            if (nodeMap.get('id') === d.id) {
              faction = (nodeMap.get('faction') as string) || 'liberal';
              break;
            }
          }
          return getFactionColor(faction);
        })
        .attr('stroke', 'rgba(51, 51, 51, 0.9)') // stroke with 0.9 transparency
        .attr('stroke-width', 3) // increased from 2 to 3
        .attr('class', 'node-shape interactable draggable');

      // create bill nodes with larger size and different shape
      nodeEnter
        .filter((d) => d.type === 'bill')
        .append('rect')
        .attr('x', -20) // increased from -15 to -20
        .attr('y', -20) // increased from -15 to -20
        .attr('width', 40) // increased from 30 to 40
        .attr('height', 40) // increased from 30 to 40
        .attr('fill', 'rgba(0, 0, 0, 0.9)') // black fill for bills with 0.9 transparency
        .attr('stroke', 'rgba(51, 51, 51, 0.9)') // stroke with 0.9 transparency
        .attr('stroke-width', 3) // increased from 2 to 3
        .attr('rx', 0) // sharp corners to make it a square
        .attr('ry', 0)
        .attr('class', 'node-shape interactable draggable');

      // add text labels with larger font
      nodeEnter
        .append('text')
        .attr('dx', 25) // moved further from bigger nodes
        .attr('dy', '.35em')
        .attr('font-size', '14px') // increased from 12px to 14px
        .attr('text-anchor', 'start')
        .text((d) => d.name)
        .attr('opacity', 0) // initially hidden
        .attr('pointer-events', 'none');

      // merge nodes
      const nodeMerge = nodeEnter.merge(node);

      // update node positions
      nodeMerge.attr(
        'transform',
        (d: D3Node) => `translate(${d.x || 0},${d.y || 0})`
      );

      // get hover state from yjs - now separate for left and right hands
      const hoveredIdsLeft = yHoveredNodeIdsLeft.toArray();
      const hoveredIdsRight = yHoveredNodeIdsRight.toArray();

      // collect all click selections from the shared map
      const allClickSelectedIds: string[] = [];
      yClientClickSelections.forEach((nodeIds: string[]) => {
        allClickSelectedIds.push(...nodeIds);
      });

      // selected nodes are separate from hovered nodes - they don't combine
      const effectiveHoveredIdsLeft = hoveredIdsLeft;
      const effectiveHoveredIdsRight = hoveredIdsRight;
      const allHoveredIds = [
        ...new Set([...effectiveHoveredIdsLeft, ...effectiveHoveredIdsRight]),
      ];

      // combine hover and click selections for highlighting (but they remain separate states)
      const allHighlightedIds = [
        ...new Set([...allHoveredIds, ...allClickSelectedIds]),
      ];

      // reset all visual states
      nodeMerge
        .select('.node-shape')
        .attr('stroke', 'rgba(51, 51, 51, 0.9)') // default stroke with 0.9 transparency
        .attr('stroke-width', 3); // updated to match bigger nodes

      // hide all links by default
      linkMerge.attr('opacity', 0);

      // new hover behavior logic - also show links for selected nodes
      const allActiveIds = [
        ...new Set([...allHoveredIds, ...allClickSelectedIds]),
      ];

      if (
        effectiveHoveredIdsLeft.length === 1 &&
        effectiveHoveredIdsRight.length === 0 &&
        allClickSelectedIds.length === 0
      ) {
        // single node hovered by left hand only (no selections) - show all its links
        const hoveredNodeId = effectiveHoveredIdsLeft[0];
        linkMerge
          .filter((d: D3Link) => {
            const source = d.source as D3Node;
            const target = d.target as D3Node;
            return source.id === hoveredNodeId || target.id === hoveredNodeId;
          })
          .attr('opacity', 0.7);
      } else if (
        effectiveHoveredIdsLeft.length === 0 &&
        effectiveHoveredIdsRight.length === 1 &&
        allClickSelectedIds.length === 0
      ) {
        // single node hovered by right hand only (no selections) - show all its links
        const hoveredNodeId = effectiveHoveredIdsRight[0];
        linkMerge
          .filter((d: D3Link) => {
            const source = d.source as D3Node;
            const target = d.target as D3Node;
            return source.id === hoveredNodeId || target.id === hoveredNodeId;
          })
          .attr('opacity', 0.7);
      } else if (
        effectiveHoveredIdsLeft.length === 1 &&
        effectiveHoveredIdsRight.length === 1 &&
        allClickSelectedIds.length === 0
      ) {
        // one node hovered by each hand (no selections) - special behavior based on node types
        const leftNodeId = effectiveHoveredIdsLeft[0];
        const rightNodeId = effectiveHoveredIdsRight[0];
        const leftNode = nodes.find((n) => n.id === leftNodeId);
        const rightNode = nodes.find((n) => n.id === rightNodeId);

        if (leftNode && rightNode) {
          if (leftNode.type === 'senator' && rightNode.type === 'bill') {
            // senator-bill: highlight only the link between them if it exists
            linkMerge
              .filter((d: D3Link) => {
                const source = d.source as D3Node;
                const target = d.target as D3Node;
                return (
                  (source.id === leftNodeId && target.id === rightNodeId) ||
                  (source.id === rightNodeId && target.id === leftNodeId)
                );
              })
              .attr('opacity', 0.7);
          } else if (leftNode.type === 'bill' && rightNode.type === 'senator') {
            // bill-senator: highlight only the link between them if it exists
            linkMerge
              .filter((d: D3Link) => {
                const source = d.source as D3Node;
                const target = d.target as D3Node;
                return (
                  (source.id === leftNodeId && target.id === rightNodeId) ||
                  (source.id === rightNodeId && target.id === leftNodeId)
                );
              })
              .attr('opacity', 0.7);
          } else if (
            leftNode.type === 'senator' &&
            rightNode.type === 'senator'
          ) {
            // senator-senator: show all links for comparison (will be handled in tooltip)
            linkMerge
              .filter((d: D3Link) => {
                const source = d.source as D3Node;
                const target = d.target as D3Node;
                return (
                  source.id === leftNodeId ||
                  target.id === leftNodeId ||
                  source.id === rightNodeId ||
                  target.id === rightNodeId
                );
              })
              .attr('opacity', 0.7);
          }
          // bill-bill behavior is left open for future implementation
        }
      } else if (allActiveIds.length > 0) {
        // show links for any hovered or selected nodes
        linkMerge
          .filter((d: D3Link) => {
            const source = d.source as D3Node;
            const target = d.target as D3Node;
            return (
              allActiveIds.includes(source.id) ||
              allActiveIds.includes(target.id)
            );
          })
          .attr('opacity', 0.7);
      }

      // apply highlight colors
      if (allHighlightedIds.length > 0) {
        // highlight hovered nodes with orange color
        if (allHoveredIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => allHoveredIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', 'rgba(243, 156, 18, 0.9)') // orange with 0.9 transparency
            .attr('stroke-width', 5); // increased from 3 to 5 for better visibility
        }

        // apply different color to clicked/selected nodes
        if (allClickSelectedIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => allClickSelectedIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', 'rgba(135, 206, 235, 0.9)') // sky blue with 0.9 transparency
            .attr('stroke-width', 5); // increased from 3 to 5 for better visibility
        }

        // update tooltip content based on hover state
        if (
          effectiveHoveredIdsLeft.length === 1 &&
          effectiveHoveredIdsRight.length === 1
        ) {
          // special tooltip for two-hand hover
          const leftNode = nodes.find(
            (n) => n.id === effectiveHoveredIdsLeft[0]
          );
          const rightNode = nodes.find(
            (n) => n.id === effectiveHoveredIdsRight[0]
          );
          updateTwoHandHoverInfo(leftNode, rightNode, nodeMap, links).catch(
            console.error
          );
        } else {
          // standard tooltip for single or multiple nodes
          const highlightedNodes = nodes.filter((n) =>
            allHighlightedIds.includes(n.id)
          );
          updateSelectedNodesInfo(highlightedNodes, nodeMap, links).catch(
            console.error
          );
        }
      } else {
        // show default tooltip message when no node is highlighted
        updateSelectedNodesInfo([], nodeMap, links).catch(console.error);
      }

      // check if initialization is needed
      const needsInitialLayout = nodes.some(
        (node) => node.x === fixedWidth / 2 && node.y === fixedHeight / 2
      );

      if (needsInitialLayout) {
        initializeLayout(nodes);
      }
    };

    // function to initialize layout
    const initializeLayout = (nodes: D3Node[]) => {
      console.log('initializing layout for voting visualization with factions');

      // organize senators by faction using yjs data
      const getFactionForNode = (nodeId: string): string => {
        for (let i = 0; i < yNodes.length; i++) {
          const nodeMap = yNodes.get(i);
          if (nodeMap.get('id') === nodeId) {
            return (nodeMap.get('faction') as string) || 'liberal';
          }
        }
        return 'liberal';
      };

      // helper function to get ideology score for a node
      const getIdeoscoreForNode = (nodeId: string): number => {
        for (let i = 0; i < yNodes.length; i++) {
          const nodeMap = yNodes.get(i);
          if (nodeMap.get('id') === nodeId) {
            return (nodeMap.get('ideoscore') as number) || 0;
          }
        }
        return 0;
      };

      // democratic factions (left side) - sorted by ideology score
      const progressiveNodes = nodes
        .filter(
          (n) =>
            n.type === 'senator' && getFactionForNode(n.id) === 'progressive'
        )
        .sort((a, b) => getIdeoscoreForNode(a.id) - getIdeoscoreForNode(b.id)); // most progressive (lowest score) first

      const liberalNodes = nodes
        .filter(
          (n) => n.type === 'senator' && getFactionForNode(n.id) === 'liberal'
        )
        .sort((a, b) => getIdeoscoreForNode(a.id) - getIdeoscoreForNode(b.id)); // most liberal (lowest score) first

      const moderateDemNodes = nodes
        .filter(
          (n) =>
            n.type === 'senator' && getFactionForNode(n.id) === 'moderate-dem'
        )
        .sort((a, b) => getIdeoscoreForNode(a.id) - getIdeoscoreForNode(b.id)); // most liberal (lowest score) first

      // republican factions (right side) - sorted by ideology score
      const moderateRepNodes = nodes
        .filter(
          (n) =>
            n.type === 'senator' && getFactionForNode(n.id) === 'moderate-rep'
        )
        .sort((a, b) => getIdeoscoreForNode(a.id) - getIdeoscoreForNode(b.id)); // most moderate (lowest score) first

      const mainstreamConsNodes = nodes
        .filter(
          (n) =>
            n.type === 'senator' &&
            getFactionForNode(n.id) === 'mainstream-conservative'
        )
        .sort((a, b) => getIdeoscoreForNode(a.id) - getIdeoscoreForNode(b.id)); // most moderate (lowest score) first

      const nationalConsNodes = nodes
        .filter(
          (n) =>
            n.type === 'senator' &&
            getFactionForNode(n.id) === 'national-conservative'
        )
        .sort((a, b) => getIdeoscoreForNode(a.id) - getIdeoscoreForNode(b.id)); // most moderate (lowest score) first

      const billNodes = nodes.filter((n) => n.type === 'bill');

      console.log(
        `layout: progressives: ${progressiveNodes.length}, liberals: ${liberalNodes.length}, moderate-dems: ${moderateDemNodes.length}, moderate-reps: ${moderateRepNodes.length}, mainstream-cons: ${mainstreamConsNodes.length}, national-cons: ${nationalConsNodes.length}, bills: ${billNodes.length}`
      );

      // define layout areas - adjusted for tooltip width
      const availableWidth = fixedWidth - tooltipWidth;
      const graphLeft = tooltipWidth + 50; // leave some margin
      const graphWidth = availableWidth - 100; // leave margin on right too

      // create layout: left third for dems, center third for bills, right third for reps
      const colWidth = graphWidth / 3;
      const leftColCenter = graphLeft + colWidth * 0.5;
      const billColX = graphLeft + colWidth * 1.5;
      const rightColCenter = graphLeft + colWidth * 2.5;

      const verticalPadding = 40; // reduced from 80 to move visualization up
      const usableHeight = fixedHeight - 2 * verticalPadding;

      // helper function to calculate grid dimensions without positioning
      const calculateGridDimensions = (nodes: D3Node[]) => {
        if (nodes.length === 0)
          return { width: 0, height: 0, cols: 0, rows: 0 };

        const nodeSpacing = 50; // consistent spacing
        const cols = Math.ceil(Math.sqrt(nodes.length));
        const rows = Math.ceil(nodes.length / cols);
        const gridWidth = (cols - 1) * nodeSpacing;
        const gridHeight = (rows - 1) * nodeSpacing;

        return { width: gridWidth, height: gridHeight, cols, rows };
      };

      // calculate dimensions for all democratic factions
      const progressiveDims = calculateGridDimensions(progressiveNodes);
      const liberalDims = calculateGridDimensions(liberalNodes);
      const moderateDemDims = calculateGridDimensions(moderateDemNodes);

      // calculate dimensions for all republican factions
      const nationalConsDims = calculateGridDimensions(nationalConsNodes);
      const mainstreamConsDims = calculateGridDimensions(mainstreamConsNodes);
      const moderateRepDims = calculateGridDimensions(moderateRepNodes);

      // calculate actual positions based on grid sizes with padding between factions
      const factionPadding = 60; // space between faction boxes

      // democratic side positioning (top to bottom)
      const demStartY = verticalPadding;
      const progressiveY = demStartY + progressiveDims.height / 2;
      const liberalY =
        progressiveY +
        progressiveDims.height / 2 +
        factionPadding +
        liberalDims.height / 2;
      const moderateDemY =
        liberalY +
        liberalDims.height / 2 +
        factionPadding +
        moderateDemDims.height / 2;

      // republican side positioning (top to bottom)
      const repStartY = verticalPadding;
      const nationalConsY = repStartY + nationalConsDims.height / 2;
      const mainstreamConsY =
        nationalConsY +
        nationalConsDims.height / 2 +
        factionPadding +
        mainstreamConsDims.height / 2;
      const moderateRepY =
        mainstreamConsY +
        mainstreamConsDims.height / 2 +
        factionPadding +
        moderateRepDims.height / 2;

      // helper function to arrange nodes in a grid with consistent spacing
      const arrangeInGrid = (
        nodes: D3Node[],
        centerX: number,
        centerY: number
      ) => {
        if (nodes.length === 0) return;

        // consistent spacing for all factions
        const nodeSpacing = 50; // fixed space between nodes

        // calculate optimal grid dimensions
        const cols = Math.ceil(Math.sqrt(nodes.length));
        const rows = Math.ceil(nodes.length / cols);

        // calculate actual grid dimensions (faction box size adjusts to content)
        const gridWidth = (cols - 1) * nodeSpacing;
        const gridHeight = (rows - 1) * nodeSpacing;

        // calculate starting position (top-left of grid)
        const startX = centerX - gridWidth / 2;
        const startY = centerY - gridHeight / 2;

        // position nodes in grid with consistent spacing
        nodes.forEach((node, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          node.x = startX + col * nodeSpacing;
          node.y = startY + row * nodeSpacing;
        });
      };

      // position progressive senators (top left) in grid
      if (progressiveNodes.length > 0) {
        arrangeInGrid(progressiveNodes, leftColCenter, progressiveY);
      }

      // position liberal senators (middle left) in grid
      if (liberalNodes.length > 0) {
        arrangeInGrid(liberalNodes, leftColCenter, liberalY);
      }

      // position moderate democratic senators (bottom left) in grid
      if (moderateDemNodes.length > 0) {
        arrangeInGrid(moderateDemNodes, leftColCenter, moderateDemY);
      }

      // position national conservative senators (top right) in grid
      if (nationalConsNodes.length > 0) {
        arrangeInGrid(nationalConsNodes, rightColCenter, nationalConsY);
      }

      // position mainstream conservative senators (middle right) in grid
      if (mainstreamConsNodes.length > 0) {
        arrangeInGrid(mainstreamConsNodes, rightColCenter, mainstreamConsY);
      }

      // position moderate republican senators (bottom right) in grid
      if (moderateRepNodes.length > 0) {
        arrangeInGrid(moderateRepNodes, rightColCenter, moderateRepY);
      }

      // position bills in center column
      if (billNodes.length > 0) {
        if (billNodes.length <= 5) {
          // for 5 or fewer bills, space them evenly in center column
          const billSpacing = usableHeight / (billNodes.length + 1);
          billNodes.forEach((node, i) => {
            node.x = billColX;
            node.y = verticalPadding + (i + 1) * billSpacing;
          });
        } else {
          // for more than 5 bills, create two columns of bills
          const leftBillColX = billColX - 40;
          const rightBillColX = billColX + 40;
          const billsPerColumn = Math.ceil(billNodes.length / 2);
          const billSpacing = usableHeight / (billsPerColumn + 1);

          billNodes.forEach((node, i) => {
            const columnIndex = Math.floor(i / billsPerColumn);
            const rowIndex = i % billsPerColumn;

            node.x = columnIndex === 0 ? leftBillColX : rightBillColX;
            node.y = verticalPadding + (rowIndex + 1) * billSpacing;
          });
        }
      }

      // sync final grid positions with yjs (no force simulation needed)
      doc!.transact(() => {
        nodes.forEach((node) => {
          for (let i = 0; i < yNodes.length; i++) {
            const nodeMap = yNodes.get(i);
            if (nodeMap.get('id') === node.id) {
              nodeMap.set('x', node.x);
              nodeMap.set('y', node.y);
              break;
            }
          }
        });
      });

      console.log(
        'grid layout complete - senators organized in rectangular faction boxes'
      );

      // update visualization
      updateVisualization();
    };

    // initial update to show visualization
    updateVisualization();

    // initialize tooltip with default message
    updateSelectedNodesInfo([]).catch(console.error);

    // set up observeDeep to update visualization when yjs data changes
    const observer = () => {
      updateVisualization();
    };

    // observe all relevant yjs data
    yNodes.observeDeep(observer);
    yLinks.observeDeep(observer);
    ySharedState.observe(observer);
    yClientClickSelections.observe(observer);
    yHoveredNodeIdsLeft.observe(observer);
    yHoveredNodeIdsRight.observe(observer);

    // initialize transform values in yjs if not already set
    if (ySharedState.get('zoomScale') === undefined) {
      doc!.transact(() => {
        ySharedState.set('zoomScale', 1);
        ySharedState.set('panX', 0);
        ySharedState.set('panY', 0);
      });
    }

    // cleanup observers when component unmounts
    return () => {
      yNodes.unobserveDeep(observer);
      yLinks.unobserveDeep(observer);
      ySharedState.unobserve(observer);
      yClientClickSelections.unobserve(observer);
      yHoveredNodeIdsLeft.unobserve(observer);
      yHoveredNodeIdsRight.unobserve(observer);

      // Remove custom interaction event listener
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
    yHoveredNodeIdsLeft,
    yHoveredNodeIdsRight,
  ]);

  // if placeholder rendering is needed due to no sync, make that transparent too
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
            senate visualization
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

  // just return the container for d3
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

export default Senate;
