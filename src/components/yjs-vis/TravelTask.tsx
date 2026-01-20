import React, { useEffect, useRef, useContext, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import {
  Topology as TopoTopology,
  GeometryCollection,
} from 'topojson-specification';
import {
  InteractionEvent,
  CreateStickyBrushEvent,
} from '@/types/interactionTypes';
import { YjsContext } from '@/context/YjsContext';
import { GetCurrentTransformFn } from '@/utils/interactionHandlers';
import { QuadTree, QuadTreeBounds } from '@/utils/quadtree';

// define a non-null version of geojsonproperties for extension
type definedgeojsonproperties = Exclude<GeoJsonProperties, null>;

interface CountryProperties extends definedgeojsonproperties {
  name: string;
}

interface WorldTopology extends TopoTopology {
  objects: {
    countries: GeometryCollection<CountryProperties>;
  };
}

// define airport data structure
interface Airport {
  IATA: string;
  'Airport Name': string;
  City: string;
  Latitude: number;
  Longitude: number;
}

// define flight data structure
interface Flight {
  id: number;
  origin: string;
  destination: string;
  price: number;
  duration: number; // assuming duration is in hours
  date: string; // date string format 'yyyy-mm-dd'
  airline: {
    code: string;
    name: string;
    continent: string;
  };
}

// define puzzle description structure
interface PuzzleDescription {
  title: string;
  description: string;
  friends: {
    user_1: {
      name: string;
      description: string;
      origin_airport: string;
      available_dates: string[];
      preferred_airlines: string[];
      max_budget: number;
    };
    user_2: {
      name: string;
      description: string;
      origin_airport: string;
      available_dates: string[];
      preferred_airlines: string[];
      max_budget: number;
    };
  };
  constraints: {
    must_arrive_same_day: boolean;
    both_must_afford: boolean;
    both_must_be_available: boolean;
    overlap_dates: string[];
  };
  evaluation_criteria: {
    valid_solution: {
      same_destination: string;
      same_date: string;
      within_budgets: string;
      date_availability: string;
      airline_preferences: string;
    };
  };
  hints: {
    overlap_dates: string;
    budget_consideration: string;
    airline_overlap: string;
    multiple_solutions: string;
  };
}

// validation result interface
interface ValidationResult {
  isValid: boolean;
  failedCriteria: string[];
}

// sticky brush data structure
interface StickyBrush {
  id: string;
  x: number; // svg coordinate x
  y: number; // svg coordinate y
  radius: number;
  type: 'origin' | 'destination';
}

// yjs shared value types
type WorldMapStateValue = string | number | boolean | null; // arrays will be y.array, not directly in map value for this type

// props interface for the WorldMap component
interface WorldMapProps {
  getCurrentTransformRef: React.MutableRefObject<GetCurrentTransformFn | null>;
}

// constants for styling
const totalWidth = 1280;
const totalHeight = 720;
const defaultFill = 'rgba(170, 170, 170, 0.6)';
const strokeColor = '#fff';
const defaultStrokeWidth = 0.5;
const mapWidth = totalWidth * (3 / 4);

// constants for airport stylings
const airportRadius = 25;
const airportFill = '#1E90FF';
const airportStroke = '#ffffff';
const airportStrokeWidth = 1.5;
const airportHighlightStroke = '#FFD580';
const airportHighlightStrokeWidth = 4;
const airportSelectedStrokeWidth = 4;
const airportSelectedLeftStroke = '#FFB6C1';
const airportSelectedRightStroke = '#ADD8E6';

// constants for line styling
const lineColor = 'rgba(116, 100, 139, 0.9)';
const lineWidth = 4;
const pinnedFlightColor = '#32CD32'; // bright green for pinned flights

// constants for panel styling
const panelWidth = totalWidth / 4;
const panelBackground = 'rgba(33, 33, 33, 0.2)';
const panelTextColor = 'white';

const TravelTask: React.FC<WorldMapProps> = ({ getCurrentTransformRef }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement | null>(null); // main group for d3 transformations
  const panelSvgRef = useRef<SVGSVGElement>(null); // ref for the info panel svg
  const animationFrameRef = useRef<number | null>(null);
  const activeLinesByPair = useRef<Map<string, SVGPathElement>>(new Map());

  // get doc from yjs context
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;

  // yjs shared state maps and arrays
  const yWorldMapState = doc?.getMap<WorldMapStateValue>('worldMapGlobalState');
  const yHoveredAirportIATAsLeft = doc?.getArray<string>(
    'worldMapHoveredIATAsLeft'
  );
  const yHoveredAirportIATAsRight = doc?.getArray<string>(
    'worldMapHoveredIATAsRight'
  );
  const ySelectedAirportIATAsLeft = doc?.getArray<string>(
    'worldMapSelectedIATAsLeft'
  );
  const ySelectedAirportIATAsRight = doc?.getArray<string>(
    'worldMapSelectedIATAsRight'
  );
  const yPanelState = doc?.getMap<WorldMapStateValue>('worldMapPanelState'); // panel svg state
  const yHoveredFlights = doc?.getArray<number>('worldMapHoveredFlights'); // track hovered flight ids globally
  const ySelectedFlights = doc?.getArray<number>('worldMapSelectedFlights'); // track pinned/selected flight ids (global)
  const yStickyBrushes = doc?.getArray<StickyBrush>('worldMapStickyBrushes'); // sticky brushes
  const yHoveredByOriginBrushes = doc?.getArray<string>(
    'worldMapHoveredByOriginBrushes'
  ); // iatas hovered by origin sticky brushes
  const yHoveredByDestinationBrushes = doc?.getArray<string>(
    'worldMapHoveredByDestinationBrushes'
  ); // iatas hovered by destination sticky brushes

  // ref to track current transform from yjs or local updates before sync
  const transformRef = useRef<{ k: number; x: number; y: number }>({
    k: 1,
    x: 0,
    y: 0,
  });

  // ref for scroll drag state for flights list
  const scrollDragStateRef = useRef<{
    left: {
      active: boolean;
      startY: number;
      startScrollTop: number;
    };
    right: {
      active: boolean;
      startY: number;
      startScrollTop: number;
    };
  }>({
    left: {
      active: false,
      startY: 0,
      startScrollTop: 0,
    },
    right: {
      active: false,
      startY: 0,
      startScrollTop: 0,
    },
  });

  // state for sync status
  const [syncStatus, setSyncStatus] = useState<boolean>(false);

  // state for flight data (loaded once)
  const allFlights = useRef<Flight[]>([]);
  // all airport data loaded once, used to map iatas to airport objects
  const allAirports = useRef<Airport[]>([]);
  // puzzle description data
  const puzzleDescription = useRef<PuzzleDescription | null>(null);

  // state for validation results
  const [validationResult, setValidationResult] = useState<ValidationResult>({
    isValid: false,
    failedCriteria: [],
  });

  // ref to track previous filter state for scroll reset detection
  const previousFilterStateRef = useRef<{
    leftIATAs: string[];
    rightIATAs: string[];
  }>({
    leftIATAs: [],
    rightIATAs: [],
  });

  // validation function
  const validateSelectedFlights = (flights: Flight[]): ValidationResult => {
    if (!puzzleDescription.current || flights.length !== 2) {
      return { isValid: false, failedCriteria: [] };
    }

    const puzzle = puzzleDescription.current;
    const [flight1, flight2] = flights;

    // helper function to validate a specific assignment
    const validateAssignment = (
      user1Flight: Flight,
      user2Flight: Flight
    ): string[] => {
      const assignmentFailures: string[] = [];

      // check both flights originate from the same airport as users
      if (user1Flight.origin !== puzzle.friends.user_1.origin_airport) {
        assignmentFailures.push(
          `flight doesn't originate from user 1's home airport`
        );
      }
      if (user2Flight.origin !== puzzle.friends.user_2.origin_airport) {
        assignmentFailures.push(
          `flight doesn't originate from user 2's home airport`
        );
      }

      // check same destination
      if (user1Flight.destination !== user2Flight.destination) {
        assignmentFailures.push(
          puzzle.evaluation_criteria.valid_solution.same_destination
        );
      }

      // check same date
      if (user1Flight.date !== user2Flight.date) {
        assignmentFailures.push(
          puzzle.evaluation_criteria.valid_solution.same_date
        );
      }

      // check within budgets
      if (user1Flight.price > puzzle.friends.user_1.max_budget) {
        assignmentFailures.push(
          `user 1's flight exceeds $${puzzle.friends.user_1.max_budget} budget`
        );
      }
      if (user2Flight.price > puzzle.friends.user_2.max_budget) {
        assignmentFailures.push(
          `user 2's flight exceeds $${puzzle.friends.user_2.max_budget} budget`
        );
      }

      // check date availability for both users
      if (!puzzle.friends.user_1.available_dates.includes(user1Flight.date)) {
        assignmentFailures.push('date not available for user 1');
      }
      if (!puzzle.friends.user_2.available_dates.includes(user2Flight.date)) {
        assignmentFailures.push('date not available for user 2');
      }

      // check airline preferences
      if (
        !puzzle.friends.user_1.preferred_airlines.includes(
          user1Flight.airline.code
        )
      ) {
        assignmentFailures.push('airline not preferred by user 1');
      }
      if (
        !puzzle.friends.user_2.preferred_airlines.includes(
          user2Flight.airline.code
        )
      ) {
        assignmentFailures.push('airline not preferred by user 2');
      }

      return assignmentFailures;
    };

    // try both possible assignments
    const assignment1Failures = validateAssignment(flight1, flight2); // user 1 gets flight1, user 2 gets flight2
    const assignment2Failures = validateAssignment(flight2, flight1); // user 1 gets flight2, user 2 gets flight1

    // if either assignment works (has no failures), the solution is valid
    if (assignment1Failures.length === 0 || assignment2Failures.length === 0) {
      return { isValid: true, failedCriteria: [] };
    }

    // if both assignments fail, return the failures from the first assignment
    // (we could combine both, but that might be confusing)
    return {
      isValid: false,
      failedCriteria: assignment1Failures,
    };
  };

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
    const timeout = setTimeout(() => {
      setSyncStatus(true);
      console.log('[worldmap] assuming sync after timeout');
    }, 2000);
    return () => clearTimeout(timeout);
  }, [doc]);

  // effect to monitor selected flights and trigger validation
  useEffect(() => {
    if (!ySelectedFlights || !puzzleDescription.current) return;

    const checkValidation = () => {
      const selectedFlightIds = ySelectedFlights.toArray();
      if (selectedFlightIds.length === 2) {
        const selectedFlights = selectedFlightIds
          .map((id) => allFlights.current.find((f) => f.id === id))
          .filter(Boolean) as Flight[];

        if (selectedFlights.length === 2) {
          const result = validateSelectedFlights(selectedFlights);
          setValidationResult(result);
        }
      } else {
        // reset validation when not exactly 2 flights selected
        setValidationResult({ isValid: false, failedCriteria: [] });
      }
    };

    ySelectedFlights.observeDeep(checkValidation);
    checkValidation(); // initial check

    return () => ySelectedFlights.unobserveDeep(checkValidation);
  }, [ySelectedFlights, puzzleDescription.current]);

  // effect to sync transform state from yjs
  useEffect(() => {
    if (!doc || !syncStatus || !yWorldMapState) return;

    const updateLocalTransform = () => {
      const scale = (yWorldMapState.get('zoomScale') as number) || 1;
      const x = (yWorldMapState.get('panX') as number) || 0;
      const y = (yWorldMapState.get('panY') as number) || 0;

      if (
        scale !== transformRef.current.k ||
        x !== transformRef.current.x ||
        y !== transformRef.current.y
      ) {
        transformRef.current = { k: scale, x, y };
        if (gRef.current) {
          d3.select(gRef.current).attr(
            'transform',
            `translate(${x},${y}) scale(${scale})`
          );
          // also re-apply styles that depend on scale
          adjustStylesForTransform(scale);
        }
      }
    };

    yWorldMapState.observe(updateLocalTransform);
    updateLocalTransform(); // initial sync

    return () => yWorldMapState.unobserve(updateLocalTransform);
  }, [doc, syncStatus, yWorldMapState]);

  // function to get pair key for origin-destination
  const getPairKey = (origin: string, destination: string) =>
    `${origin}->${destination}`;

  // function to find airport data by iata code
  const getAirportByIATA = (iata: string): Airport | undefined => {
    return allAirports.current.find((ap) => ap.IATA === iata);
  };

  // function to adjust styles based on transform (e.g., stroke widths)
  const adjustStylesForTransform = (scale: number) => {
    if (
      !gRef.current ||
      !yWorldMapState ||
      !yHoveredAirportIATAsLeft ||
      !yHoveredAirportIATAsRight ||
      !ySelectedAirportIATAsLeft ||
      !ySelectedAirportIATAsRight
    )
      return;
    const svgRoot = d3.select(gRef.current);

    svgRoot
      .selectAll('circle.airport')
      .attr('r', airportRadius / scale)
      .attr('stroke-width', (d, i, nodes) => {
        const element = nodes[i] as SVGCircleElement;
        const airportIATA = (d3.select(element).datum() as Airport).IATA;
        const isSelectedLeft = ySelectedAirportIATAsLeft
          .toArray()
          .includes(airportIATA);
        const isSelectedRight = ySelectedAirportIATAsRight
          .toArray()
          .includes(airportIATA);

        if (isSelectedLeft || isSelectedRight) {
          return airportSelectedStrokeWidth / scale;
        }

        const isHoveredByHand =
          yHoveredAirportIATAsLeft.toArray().includes(airportIATA) ||
          yHoveredAirportIATAsRight.toArray().includes(airportIATA);

        const isHoveredBySticky =
          yHoveredByOriginBrushes?.toArray().includes(airportIATA) ||
          yHoveredByDestinationBrushes?.toArray().includes(airportIATA);

        if (isHoveredByHand || isHoveredBySticky) {
          return airportHighlightStrokeWidth / scale;
        }
        return airportStrokeWidth / scale;
      })
      .attr('stroke', (d, i, nodes) => {
        const element = nodes[i] as SVGCircleElement;
        const airportIATA = (d3.select(element).datum() as Airport).IATA;
        const isSelectedLeft = ySelectedAirportIATAsLeft
          .toArray()
          .includes(airportIATA);
        const isSelectedRight = ySelectedAirportIATAsRight
          .toArray()
          .includes(airportIATA);

        if (isSelectedLeft) {
          return airportSelectedLeftStroke;
        }
        if (isSelectedRight) {
          return airportSelectedRightStroke;
        }

        // if not selected by either, then check for hover
        const isHoveredLeft = yHoveredAirportIATAsLeft
          .toArray()
          .includes(airportIATA);
        const isHoveredRight = yHoveredAirportIATAsRight
          .toArray()
          .includes(airportIATA);
        const isHoveredBySticky =
          yHoveredByOriginBrushes?.toArray().includes(airportIATA) ||
          yHoveredByDestinationBrushes?.toArray().includes(airportIATA);

        if (isHoveredLeft || isHoveredRight || isHoveredBySticky) {
          return airportHighlightStroke;
        }
        return airportStroke;
      })
      .attr('fill', airportFill); // ensure fill is reset/set

    activeLinesByPair.current.forEach((line, pairKey) => {
      d3.select(line).attr('stroke-width', lineWidth / scale);

      // extract origin and destination from pair key (format: "ORIGIN->DESTINATION")
      const [originIATA, destinationIATA] = pairKey.split('->');

      // check if this line corresponds to any selected (pinned) flight
      const selectedFlights = ySelectedFlights?.toArray() || [];
      const selectedFlightData = selectedFlights
        .map((id) => allFlights.current.find((f) => f.id === id))
        .filter(Boolean) as Flight[];

      const isPinned = selectedFlightData.some(
        (flight) =>
          flight.origin === originIATA && flight.destination === destinationIATA
      );

      // check if this line corresponds to any hovered flight
      const hoveredFlights = yHoveredFlights?.toArray() || [];
      const hoveredFlightData = hoveredFlights
        .map((id) => allFlights.current.find((f) => f.id === id))
        .filter(Boolean) as Flight[];

      const isHighlighted = hoveredFlightData.some(
        (flight) =>
          flight.origin === originIATA && flight.destination === destinationIATA
      );

      // use pinned color if pinned, highlight color if highlighted, otherwise default
      const strokeColor = isPinned
        ? pinnedFlightColor
        : isHighlighted
          ? airportHighlightStroke
          : lineColor;
      d3.select(line).attr('stroke', strokeColor);
    });
  };

  // function to draw line between airports by iata codes
  const drawAirportLineByIATAs = (
    originIATA: string,
    destinationIATA: string,
    projection: d3.GeoProjection,
    highlight = false,
    pinned = false
  ) => {
    if (!gRef.current || !projection) return;

    const originAirport = getAirportByIATA(originIATA);
    const destAirport = getAirportByIATA(destinationIATA);

    if (!originAirport || !destAirport) return;

    const pairKey = getPairKey(originIATA, destinationIATA);
    if (activeLinesByPair.current.has(pairKey)) return;

    const originCoords = projection([
      originAirport.Longitude,
      originAirport.Latitude,
    ]);
    const destCoords = projection([
      destAirport.Longitude,
      destAirport.Latitude,
    ]);

    if (!originCoords || !destCoords) return;

    // calculate arc control point for curved flight path
    const midX = (originCoords[0] + destCoords[0]) / 2;
    const midY = (originCoords[1] + destCoords[1]) / 2;

    // calculate distance between points to determine arc height
    const distance = Math.sqrt(
      Math.pow(destCoords[0] - originCoords[0], 2) +
        Math.pow(destCoords[1] - originCoords[1], 2)
    );

    // arc height is proportional to distance (but capped for very long distances)
    const arcHeight = Math.min(distance * 0.2, 100);

    // control point is above the midpoint
    const controlX = midX;
    const controlY = midY - arcHeight;

    // create quadratic curve path
    const pathData = `M ${originCoords[0]} ${originCoords[1]} Q ${controlX} ${controlY} ${destCoords[0]} ${destCoords[1]}`;

    // use pinned color if pinned, highlight color if highlighted, otherwise use default line color
    const strokeColor = pinned
      ? pinnedFlightColor
      : highlight
        ? airportHighlightStroke
        : lineColor;

    const line = d3
      .select(gRef.current)
      .append('path')
      .attr('d', pathData)
      .attr('stroke', strokeColor)
      .attr('stroke-width', lineWidth / transformRef.current.k) // use current transform
      .attr('fill', 'none')
      .style('stroke-linecap', 'round')
      .style('pointer-events', 'none'); // make flight lines uninteractable

    activeLinesByPair.current.set(pairKey, line.node()!);
  };

  // function to clear all lines
  const clearAllLines = () => {
    activeLinesByPair.current.forEach((line) => {
      d3.select(line).remove();
    });
    activeLinesByPair.current.clear();
  };

  // function to redraw all lines based on yjs hovered airport iatas
  const redrawAllLinesFromYjs = (projection: d3.GeoProjection | null) => {
    if (
      !projection ||
      !yHoveredAirportIATAsLeft ||
      !yHoveredAirportIATAsRight ||
      !ySelectedAirportIATAsLeft ||
      !ySelectedAirportIATAsRight ||
      !yHoveredByOriginBrushes ||
      !yHoveredByDestinationBrushes
    )
      return;
    clearAllLines();

    // first draw pinned flight lines (always visible in green)
    drawPinnedFlightLines(projection);

    const hoveredLeftIATAs = yHoveredAirportIATAsLeft.toArray();
    const hoveredRightIATAs = yHoveredAirportIATAsRight.toArray();
    const selectedLeftIATAs = ySelectedAirportIATAsLeft.toArray();
    const selectedRightIATAs = ySelectedAirportIATAsRight.toArray();
    const originStickyHoverIATAs = yHoveredByOriginBrushes.toArray();
    const destinationStickyHoverIATAs = yHoveredByDestinationBrushes.toArray();

    // combine selected and hovered for line drawing
    const effectiveLeftIATAs = Array.from(
      new Set([
        ...selectedLeftIATAs,
        ...hoveredLeftIATAs,
        ...originStickyHoverIATAs,
      ])
    );
    const effectiveRightIATAs = Array.from(
      new Set([
        ...selectedRightIATAs,
        ...hoveredRightIATAs,
        ...destinationStickyHoverIATAs,
      ])
    );

    // get hovered flights to determine which routes should be highlighted
    const hoveredFlights = yHoveredFlights?.toArray() || [];
    const hoveredFlightData = hoveredFlights
      .map((id) => allFlights.current.find((f) => f.id === id))
      .filter(Boolean) as Flight[];

    effectiveLeftIATAs.forEach((originIATA) => {
      effectiveRightIATAs.forEach((destIATA) => {
        if (originIATA !== destIATA) {
          // prevent self-loops if an airport is somehow in both effective lists

          // check if this route corresponds to any hovered flight
          const isHighlighted = hoveredFlightData.some(
            (flight) =>
              flight.origin === originIATA && flight.destination === destIATA
          );

          drawAirportLineByIATAs(
            originIATA,
            destIATA,
            projection,
            isHighlighted
          );
        }
      });
    });
  };

  // function to update the info panel with hovered/selected airports from yjs
  const updateInfoPanelFromYjs = () => {
    if (
      !yWorldMapState ||
      !yHoveredAirportIATAsLeft ||
      !yHoveredAirportIATAsRight ||
      !ySelectedAirportIATAsLeft ||
      !ySelectedAirportIATAsRight ||
      !panelSvgRef.current ||
      !yPanelState ||
      !yHoveredByOriginBrushes ||
      !yHoveredByDestinationBrushes
    )
      return;

    const panelSvg = d3.select(panelSvgRef.current);

    // clear existing content including any flight-related clipPaths in defs
    panelSvg.selectAll('g.panel-content').remove();
    panelSvg.select('defs').selectAll('clipPath[id^="flights-"]').remove();

    const contentGroup = panelSvg.append('g').attr('class', 'panel-content');

    // add a background rect that absorbs all events to prevent bleeding through
    contentGroup
      .append('rect')
      .attr('class', 'interactable draggable') // make it interactable to absorb events
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', panelWidth)
      .attr('height', totalHeight)
      .attr('fill', 'transparent') // invisible but still catches events
      .style('pointer-events', 'all'); // ensure it catches all pointer events

    const hoveredLeftIATAs = yHoveredAirportIATAsLeft.toArray();
    const hoveredRightIATAs = yHoveredAirportIATAsRight.toArray();
    const selectedLeftIATAs = ySelectedAirportIATAsLeft.toArray();
    const selectedRightIATAs = ySelectedAirportIATAsRight.toArray();
    const originStickyHoverIATAs = yHoveredByOriginBrushes.toArray();
    const destinationStickyHoverIATAs = yHoveredByDestinationBrushes.toArray();

    // display logic: selected items are primary. hovered items are secondary if not selected.
    // for flight filtering, combine selected and hovered items (pins are sticky hovers)
    const leftFilterIATAs = Array.from(
      new Set([
        ...selectedLeftIATAs,
        ...hoveredLeftIATAs,
        ...originStickyHoverIATAs,
      ])
    );
    const rightFilterIATAs = Array.from(
      new Set([
        ...selectedRightIATAs,
        ...hoveredRightIATAs,
        ...destinationStickyHoverIATAs,
      ])
    );

    // check if filter state has changed and update tracking (preserve scroll position when possible)
    const previousFilterState = previousFilterStateRef.current;
    const filterStateChanged =
      JSON.stringify(leftFilterIATAs.sort()) !==
        JSON.stringify(previousFilterState.leftIATAs.sort()) ||
      JSON.stringify(rightFilterIATAs.sort()) !==
        JSON.stringify(previousFilterState.rightIATAs.sort());
    let currentFilteredFlights: Flight[] = [];
    if (leftFilterIATAs.length > 0 && rightFilterIATAs.length > 0) {
      currentFilteredFlights = allFlights.current.filter(
        (flight) =>
          leftFilterIATAs.includes(flight.origin) &&
          rightFilterIATAs.includes(flight.destination)
      );
    } else if (leftFilterIATAs.length > 0) {
      currentFilteredFlights = allFlights.current.filter((flight) =>
        leftFilterIATAs.includes(flight.origin)
      );
    } else if (rightFilterIATAs.length > 0) {
      currentFilteredFlights = allFlights.current.filter((flight) =>
        rightFilterIATAs.includes(flight.destination)
      );
    }

    // handle scroll position when filter state changes (preserve scroll position when possible)
    if (filterStateChanged && yPanelState) {
      // if either origins or destinations is empty, reset scroll to 0
      if (leftFilterIATAs.length === 0 || rightFilterIATAs.length === 0) {
        yPanelState.set('flightsScrollY', 0);
      } else {
        // calculate new max scroll position for the filtered flights
        const currentScrollY =
          (yPanelState.get('flightsScrollY') as number) || 0;

        // calculate layout dimensions for max scroll calculation
        const paddingForScroll = 6;
        const sectionGapForScroll = 12;
        const titleHeightForScroll = 20;
        const itemHeightForScroll = 35;
        const maxItemsForScroll = 4;
        const bottomPaddingForScroll = 10;
        const distributionsFixedHeightForScroll = 10 + 3 * 70;
        const selectionsYForScroll = paddingForScroll;
        const boxHeightForScroll =
          titleHeightForScroll +
          25 +
          maxItemsForScroll * itemHeightForScroll -
          bottomPaddingForScroll;
        const flightsYForScroll =
          selectionsYForScroll + boxHeightForScroll + sectionGapForScroll;
        const flightsContentYForScroll = flightsYForScroll + 10;
        const flightsContentHeightForScroll =
          totalHeight -
          flightsContentYForScroll -
          distributionsFixedHeightForScroll -
          sectionGapForScroll -
          paddingForScroll;

        // calculate new max scroll based on current filtered flights
        const newMaxScroll = Math.max(
          0,
          currentFilteredFlights.length * 80 - flightsContentHeightForScroll
        );

        // clamp current scroll position to new valid range
        const clampedScrollY = Math.max(
          0,
          Math.min(newMaxScroll, currentScrollY)
        );

        yPanelState.set('flightsScrollY', clampedScrollY);
      }

      previousFilterStateRef.current = {
        leftIATAs: [...leftFilterIATAs],
        rightIATAs: [...rightFilterIATAs],
      };
    }

    // svg panel layout constants
    const padding = 6;
    const sectionGap = 12; // consistent spacing between all sections
    // const sectionHeight = (totalHeight - 2 * padding - 2 * sectionGap) / 3; // properly account for gaps between sections // removing the 1/3 rule

    // calculate fixed height for origins/destinations boxes to fit exactly 4 entries
    const titleHeight = 20; // height for "origins"/"destinations" title
    const itemHeight = 35; // height per airport item
    const maxItems = 4; // exactly 4 entries
    const topPadding = 10; // padding above the boxes
    const bottomPadding = 10; // padding below the boxes to match top
    const boxHeight = titleHeight + 25 + maxItems * itemHeight - bottomPadding; // 25px padding after title, reduced by bottom padding for balance

    // section 1: current selections
    const selectionsY = padding;
    const selectionsGroup = contentGroup
      .append('g')
      .attr('class', 'selections-section');

    // origins and destinations boxes
    const boxY = selectionsY + topPadding; // use the defined topPadding constant
    // const boxHeight = sectionHeight - 10; // adjusted for removed title // removing this line since we have fixed height now
    const boxWidth = (panelWidth - 2 * padding - 8) / 2; // wider boxes with smaller gap

    // origins box background
    selectionsGroup
      .append('rect')
      .attr('x', padding)
      .attr('y', boxY)
      .attr('width', boxWidth)
      .attr('height', boxHeight)
      .attr('fill', 'rgba(255, 255, 255, 0.12)')
      .attr('rx', 6)
      .attr('ry', 6);

    // origins title
    selectionsGroup
      .append('text')
      .attr('x', padding + 8)
      .attr('y', boxY + 20)
      .attr('fill', 'rgba(255, 255, 255, 0.95)')
      .attr('font-size', '16px')
      .attr('font-weight', '500')
      .style('font-family', 'system-ui, sans-serif')
      .style('letter-spacing', '0.05em')
      .text('Origins');

    // origins content
    const uniqueLeftDisplayIATAs = Array.from(
      new Set([
        ...selectedLeftIATAs,
        ...hoveredLeftIATAs,
        ...originStickyHoverIATAs,
      ])
    );
    const leftAirportsToShow = uniqueLeftDisplayIATAs
      .map(getAirportByIATA)
      .filter(Boolean) as Airport[];

    // show maximum 3 airports, reserve 4th slot for "more" if needed
    const maxAirportsToShow = 3;
    const leftToShow = leftAirportsToShow.slice(0, maxAirportsToShow);
    const leftRemaining = leftAirportsToShow.length - leftToShow.length;

    leftToShow.forEach((airport, index) => {
      const isSelected = selectedLeftIATAs.includes(airport.IATA);
      const itemY = boxY + 45 + index * 35;

      // background for airport item
      selectionsGroup
        .append('rect')
        .attr('x', padding + 4 + (isSelected ? 1 : 0)) // reduced padding from 8 to 4
        .attr('y', itemY - 17 + (isSelected ? 1 : 0)) // adjust for stroke width
        .attr('width', boxWidth - 8 - (isSelected ? 2 : 0)) // increased width from -16 to -8
        .attr('height', 30 - (isSelected ? 2 : 0)) // reduce height for stroke
        .attr('fill', 'rgba(232, 27, 35, 0.3)')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('stroke', isSelected ? airportSelectedLeftStroke : 'none')
        .attr('stroke-width', isSelected ? 2 : 0);

      selectionsGroup
        .append('text')
        .attr('x', padding + 10) // adjusted text position for new padding
        .attr('y', itemY) // center vertically within container
        .attr('fill', panelTextColor)
        .attr('font-size', '15px') // reduced from 16px to 15px
        .attr('font-weight', '500') // consistent weight, no bold for selected
        .style('font-family', 'system-ui, sans-serif')
        .attr('dominant-baseline', 'middle') // center text vertically
        .text(`${airport.IATA} (${airport.City})`);
    });

    if (leftRemaining > 0) {
      const remainingY = boxY + 45 + leftToShow.length * 35;
      selectionsGroup
        .append('rect')
        .attr('x', padding + 4) // reduced padding from 8 to 4
        .attr('y', remainingY - 17)
        .attr('width', boxWidth - 8) // increased width from -16 to -8
        .attr('height', 30)
        .attr('fill', 'rgba(232, 27, 35, 0.3)')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('opacity', 0.7);

      selectionsGroup
        .append('text')
        .attr('x', padding + 10) // adjusted text position for new padding
        .attr('y', remainingY) // center vertically within container
        .attr('fill', panelTextColor)
        .attr('font-size', '15px') // reduced from 16px to 15px
        .attr('font-weight', '500') // consistent weight, no bold for selected
        .style('font-family', 'system-ui, sans-serif')
        .attr('dominant-baseline', 'middle') // center text vertically
        .attr('opacity', 0.7)
        .text(`and ${leftRemaining} more...`);
    }

    // destinations box background (side by side with origins)
    const destBoxX = padding + boxWidth + 8; // 8px gap between boxes
    selectionsGroup
      .append('rect')
      .attr('x', destBoxX)
      .attr('y', boxY)
      .attr('width', boxWidth)
      .attr('height', boxHeight)
      .attr('fill', 'rgba(255, 255, 255, 0.15)')
      .attr('rx', 6)
      .attr('ry', 6);

    // destinations title
    selectionsGroup
      .append('text')
      .attr('x', destBoxX + 8)
      .attr('y', boxY + 20)
      .attr('fill', 'rgba(255, 255, 255, 0.95)')
      .attr('font-size', '16px')
      .attr('font-weight', '500')
      .style('font-family', 'system-ui, sans-serif')
      .style('letter-spacing', '0.05em')
      .text('Destinations');

    // destinations content
    const uniqueRightDisplayIATAs = Array.from(
      new Set([
        ...selectedRightIATAs,
        ...hoveredRightIATAs,
        ...destinationStickyHoverIATAs,
      ])
    );
    const rightAirportsToShow = uniqueRightDisplayIATAs
      .map(getAirportByIATA)
      .filter(Boolean) as Airport[];

    // show maximum 3 airports, reserve 4th slot for "more" if needed
    const rightToShow = rightAirportsToShow.slice(0, maxAirportsToShow);
    const rightRemaining = rightAirportsToShow.length - rightToShow.length;

    rightToShow.forEach((airport, index) => {
      const isSelected = selectedRightIATAs.includes(airport.IATA);
      const itemY = boxY + 45 + index * 35;

      // background for airport item
      selectionsGroup
        .append('rect')
        .attr('x', destBoxX + 4 + (isSelected ? 1 : 0)) // reduced padding from 8 to 4
        .attr('y', itemY - 17 + (isSelected ? 1 : 0)) // adjust for stroke width
        .attr('width', boxWidth - 8 - (isSelected ? 2 : 0)) // increased width from -16 to -8
        .attr('height', 30 - (isSelected ? 2 : 0)) // reduce height for stroke
        .attr('fill', 'rgba(0, 174, 243, 0.3)')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('stroke', isSelected ? airportSelectedRightStroke : 'none')
        .attr('stroke-width', isSelected ? 2 : 0);

      selectionsGroup
        .append('text')
        .attr('x', destBoxX + 10) // adjusted text position for new padding
        .attr('y', itemY) // center vertically within container
        .attr('fill', panelTextColor)
        .attr('font-size', '15px') // reduced from 16px to 15px
        .attr('font-weight', '500') // consistent weight, no bold for selected
        .style('font-family', 'system-ui, sans-serif')
        .attr('dominant-baseline', 'middle') // center text vertically
        .text(`${airport.IATA} (${airport.City})`);
    });

    if (rightRemaining > 0) {
      const remainingY = boxY + 45 + rightToShow.length * 35;
      selectionsGroup
        .append('rect')
        .attr('x', destBoxX + 4)
        .attr('y', remainingY - 17)
        .attr('width', boxWidth - 8)
        .attr('height', 30)
        .attr('fill', 'rgba(0, 174, 243, 0.3)')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('opacity', 0.7);

      selectionsGroup
        .append('text')
        .attr('x', destBoxX + 10)
        .attr('y', remainingY) // center vertically within container
        .attr('fill', panelTextColor)
        .attr('font-size', '15px') // reduced from 16px to 15px
        .attr('font-weight', '500') // consistent weight, no bold for selected
        .style('font-family', 'system-ui, sans-serif')
        .attr('dominant-baseline', 'middle') // center text vertically
        .attr('opacity', 0.7)
        .text(`and ${rightRemaining} more...`);
    }

    // section 2: available flights
    const flightsY = selectionsY + boxHeight + sectionGap;
    const flightsGroup = contentGroup
      .append('g')
      .attr('class', 'flights-section');

    // calculate space for distributions section (fixed size)
    const distributionsFixedHeight = 10 + 3 * 70; // 10px for content Y offset + space for 3 histograms at 70px each

    // flights content area - use all available space except what's reserved for distributions
    const flightsContentY = flightsY + 10; // reduced from flightsY + 40 since no title
    const flightsContentHeight =
      totalHeight -
      flightsContentY -
      distributionsFixedHeight -
      sectionGap -
      padding; // use all remaining space

    // get current scroll position from yjs or default to 0
    const scrollOffset = (yPanelState.get('flightsScrollY') as number) || 0;

    const displayOriginsSelected = leftFilterIATAs.length > 0;
    const displayDestinationsSelected = rightFilterIATAs.length > 0;

    if (!displayOriginsSelected || !displayDestinationsSelected) {
      // first line
      flightsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', flightsContentY + flightsContentHeight / 2 - 10)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('Select origins (left) and destinations (right)');

      // second line
      flightsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', flightsContentY + flightsContentHeight / 2 + 10)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('to see available flights.');
    } else if (currentFilteredFlights.length === 0) {
      flightsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', flightsContentY + flightsContentHeight / 2)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('No direct flights found for the current selection.');
    } else {
      // sort flights by price (cheapest first)
      const flightsToShow = currentFilteredFlights.sort(
        (a, b) => a.price - b.price
      );

      // create clipping path for flights list (ensure unique id and remove any existing one first)
      const clipId = 'flights-clip';
      const defs = panelSvg.select('defs');
      defs.select(`clipPath#${clipId}`).remove();
      defs
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', padding)
        .attr('y', flightsContentY)
        .attr('width', panelWidth - 2 * padding)
        .attr('height', flightsContentHeight);

      const flightsListGroup = flightsGroup
        .append('g')
        .attr('class', 'flights-list')
        .attr('clip-path', `url(#${clipId})`);

      const itemHeight = 80;
      const visibleItems = Math.ceil(flightsContentHeight / itemHeight) + 1;
      const startIndex = Math.max(0, Math.floor(scrollOffset / itemHeight));
      const endIndex = Math.min(
        flightsToShow.length,
        startIndex + visibleItems
      );

      for (let i = startIndex; i < endIndex; i++) {
        const flight = flightsToShow[i];
        const itemY = flightsContentY + i * itemHeight - scrollOffset;

        // get current hovered flights from yjs state
        const hoveredFlights = yHoveredFlights?.toArray() || [];
        const isHovered = hoveredFlights.includes(flight.id);

        // get current selected flights from yjs state
        const selectedFlights = ySelectedFlights?.toArray() || [];
        const isSelected = selectedFlights.includes(flight.id);

        // create a group for each flight item
        const flightGroup = flightsListGroup
          .append('g')
          .attr('class', 'flight-item')
          .attr('data-flight-id', flight.id.toString());

        // flight item background (make this the interactable and draggable element)
        flightGroup
          .append('rect')
          .attr('class', 'interactable draggable') // add both interactable and draggable classes to the rect
          .attr('data-flight-id', flight.id.toString()) // add flight id to the rect too
          .attr('x', padding + 4)
          .attr('y', itemY)
          .attr('width', panelWidth - 2 * padding - 8)
          .attr('height', itemHeight - 4)
          .attr('fill', 'rgba(255, 255, 255, 0.12)')
          .attr(
            'stroke',
            isSelected
              ? pinnedFlightColor
              : isHovered
                ? airportHighlightStroke
                : 'none'
          )
          .attr('stroke-width', isSelected || isHovered ? 2 : 0)
          .attr('rx', 3)
          .attr('ry', 3);

        // flight route and price
        flightGroup
          .append('text')
          .attr('x', padding + 8)
          .attr('y', itemY + 20)
          .attr('fill', panelTextColor)
          .attr('font-size', '22px')
          .attr('font-weight', '600')
          .style('font-family', 'system-ui, sans-serif')
          .style('pointer-events', 'none')
          .text(`${flight.origin} → ${flight.destination}`);

        flightGroup
          .append('text')
          .attr('x', panelWidth - padding - 8)
          .attr('y', itemY + 20) // back to top line with route
          .attr('fill', panelTextColor)
          .attr('font-size', '22px') // back to 20px to match route
          .attr('font-weight', '600')
          .attr('text-anchor', 'end')
          .style('font-family', 'system-ui, sans-serif')
          .style('pointer-events', 'none')
          .text(`$${flight.price.toFixed(2)}`);

        // airline information (full name only, no abbreviation)
        flightGroup
          .append('text')
          .attr('x', padding + 8)
          .attr('y', itemY + 40)
          .attr('fill', panelTextColor)
          .attr('font-size', '18px')
          .attr('font-weight', '600')
          .style('font-family', 'system-ui, sans-serif')
          .style('pointer-events', 'none')
          .text(`${flight.airline.name}`);

        // flight duration (same styling as price)
        flightGroup
          .append('text')
          .attr('x', panelWidth - padding - 8)
          .attr('y', itemY + itemHeight - 12) // anchored to bottom with 12px margin
          .attr('fill', panelTextColor)
          .attr('font-size', '18px')
          .attr('font-weight', '600')
          .attr('text-anchor', 'end')
          .style('font-family', 'system-ui, sans-serif')
          .style('pointer-events', 'none')
          .text(`${flight.duration.toFixed(1)}h`);

        // flight date (same size and styling as airline name)
        // parse date as local date to avoid timezone issues
        const dateParts = flight.date.split('-');
        const flightDate = new Date(
          parseInt(dateParts[0]),
          parseInt(dateParts[1]) - 1,
          parseInt(dateParts[2])
        );
        const formattedDate = flightDate.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        flightGroup
          .append('text')
          .attr('x', padding + 8)
          .attr('y', itemY + itemHeight - 12) // anchored to bottom with 12px margin
          .attr('fill', panelTextColor)
          .attr('font-size', '18px')
          .attr('font-weight', '600')
          .style('font-family', 'system-ui, sans-serif')
          .style('pointer-events', 'none')
          .text(formattedDate);
      }

      // add scrollbar if there are more flights than can be displayed
      const totalContentHeight = flightsToShow.length * itemHeight;
      if (totalContentHeight > flightsContentHeight) {
        const scrollbarWidth = 4;
        const scrollbarX = panelWidth - padding - scrollbarWidth;

        // scrollbar track
        flightsGroup
          .append('rect')
          .attr('x', scrollbarX)
          .attr('y', flightsContentY)
          .attr('width', scrollbarWidth)
          .attr('height', flightsContentHeight)
          .attr('fill', 'rgba(255, 255, 255, 0.1)')
          .attr('rx', 2)
          .attr('ry', 2);

        // scrollbar thumb
        const scrollRatio = Math.min(
          1,
          flightsContentHeight / totalContentHeight
        );
        const thumbHeight = flightsContentHeight * scrollRatio;
        const maxScrollForThumb = Math.max(
          0,
          totalContentHeight - flightsContentHeight
        );
        const thumbY =
          maxScrollForThumb > 0
            ? flightsContentY +
              (scrollOffset / maxScrollForThumb) *
                (flightsContentHeight - thumbHeight)
            : flightsContentY;

        flightsGroup
          .append('rect')
          .attr('x', scrollbarX)
          .attr('y', thumbY)
          .attr('width', scrollbarWidth)
          .attr('height', thumbHeight)
          .attr('fill', 'rgba(255, 255, 255, 0.4)')
          .attr('rx', 2)
          .attr('ry', 2);
      }
    }

    // section 3: flight distributions
    const distributionsY = flightsContentY + flightsContentHeight + sectionGap;
    const distributionsGroup = contentGroup
      .append('g')
      .attr('class', 'distributions-section');

    // distributions content
    const distributionsContentY = distributionsY + 10; // reduced from distributionsY + 40 since no title
    const flightsToAnalyze = currentFilteredFlights;

    if (!displayOriginsSelected || !displayDestinationsSelected) {
      // first line
      distributionsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', distributionsContentY + 40)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('Select origins (left) and destinations (right)');

      // second line
      distributionsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', distributionsContentY + 60)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('to see flight distributions.');
    } else if (flightsToAnalyze.length === 0) {
      distributionsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', distributionsContentY + 50)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('no flight data available for distribution analysis.');
    } else {
      const prices = flightsToAnalyze.map((f) => f.price);
      const durations = flightsToAnalyze.map((f) => f.duration);
      // parse dates as local dates to avoid timezone issues
      const dates = flightsToAnalyze.map((f) => {
        const dateParts = f.date.split('-');
        return new Date(
          parseInt(dateParts[0]),
          parseInt(dateParts[1]) - 1,
          parseInt(dateParts[2])
        );
      });

      const histHeight = 40; // increased from 32 for better visibility
      const numBins = 8;
      const histogramBarFill = 'rgba(255, 255, 255, 0.4)';
      const calculatedHistWidth = panelWidth - 2 * padding - 8; // match other sections' width calculation

      // histograms use <= for the last bin to include maximum values (edge case fix)

      // create histograms
      let currentHistY = distributionsContentY;

      // price histogram
      if (prices.length > 0) {
        const [minVal, maxVal] = d3.extent(prices);
        if (minVal !== undefined && maxVal !== undefined) {
          const histGroup = distributionsGroup
            .append('g')
            .attr('transform', `translate(${padding + 4}, ${currentHistY})`);

          const xScale = d3
            .scaleLinear()
            .domain([minVal, maxVal])
            .range([0, calculatedHistWidth]);

          const histogram = d3
            .histogram<number, number>()
            .value((d) => d)
            .domain([minVal, maxVal])
            .thresholds(xScale.ticks(numBins));

          const bins = histogram(prices);
          const yMax = d3.max(bins, (d) => d.length) ?? 0;
          const yScale = d3
            .scaleLinear()
            .range([histHeight, 0])
            .domain([0, yMax]);

          // calculate consistent bar width
          const barWidth = calculatedHistWidth / bins.length;

          // get hovered flights for highlighting
          const hoveredFlightIds = yHoveredFlights?.toArray() || [];
          const hoveredFlightsData = hoveredFlightIds
            .map((id) => flightsToAnalyze.find((f) => f.id === id))
            .filter(Boolean) as Flight[];

          // bars
          histGroup
            .selectAll('rect')
            .data(bins)
            .join('rect')
            .attr('x', (d, i) => i * barWidth)
            .attr('width', barWidth - 1) // subtract 1 for spacing between bars
            .attr('y', (d) => yScale(d.length))
            .attr('height', (d) => histHeight - yScale(d.length))
            .attr('fill', (d) => {
              // check if any hovered flight's price falls in this bin
              const binContainsHoveredFlight = hoveredFlightsData.some(
                (flight) => {
                  const binStart = d.x0!;
                  const binEnd = d.x1!;
                  // fix for edge values: use <= for the last bin to include max value
                  const isLastBin = bins.indexOf(d) === bins.length - 1;
                  return (
                    flight.price >= binStart &&
                    (isLastBin ? flight.price <= binEnd : flight.price < binEnd)
                  );
                }
              );
              return binContainsHoveredFlight
                ? airportHighlightStroke
                : histogramBarFill;
            });

          // x-axis
          const numTicks = Math.min(bins.length, 4);
          const tickIndices = [];
          if (numTicks === 1) {
            tickIndices.push(0);
          } else {
            for (let i = 0; i < numTicks; i++) {
              tickIndices.push(
                Math.round((i * (bins.length - 1)) / (numTicks - 1))
              );
            }
          }

          const xAxis = d3
            .axisBottom(
              d3
                .scaleLinear()
                .range([0, calculatedHistWidth])
                .domain([0, bins.length - 1])
            )
            .tickValues(tickIndices)
            .tickFormat((d) => {
              const binIndex = Math.round(d as number);
              if (binIndex >= 0 && binIndex < bins.length) {
                const bin = bins[binIndex];
                return `$${((bin.x0! + bin.x1!) / 2).toFixed(0)}`;
              }
              return '';
            });

          histGroup
            .append('g')
            .attr('transform', `translate(0, ${histHeight})`)
            .call(xAxis)
            .call((g) =>
              g
                .selectAll('.tick')
                .attr(
                  'transform',
                  (d) =>
                    `translate(${(d as number) * barWidth + barWidth / 2}, 0)`
                )
            )
            .selectAll('text')
            .attr('fill', panelTextColor)
            .attr('font-size', '18px')
            .style('font-family', 'system-ui, sans-serif');

          histGroup.selectAll('path, line').attr('stroke', panelTextColor);

          currentHistY += 70; // increased from 50 to accommodate taller histograms
        }
      }

      // duration histogram
      if (durations.length > 0) {
        const [minVal, maxVal] = d3.extent(durations);
        if (minVal !== undefined && maxVal !== undefined) {
          const histGroup = distributionsGroup
            .append('g')
            .attr('transform', `translate(${padding + 4}, ${currentHistY})`);

          const xScale = d3
            .scaleLinear()
            .domain([minVal, maxVal])
            .range([0, calculatedHistWidth]);

          const histogram = d3
            .histogram<number, number>()
            .value((d) => d)
            .domain([minVal, maxVal])
            .thresholds(xScale.ticks(numBins));

          const bins = histogram(durations);
          const yMax = d3.max(bins, (d) => d.length) ?? 0;
          const yScale = d3
            .scaleLinear()
            .range([histHeight, 0])
            .domain([0, yMax]);

          // calculate consistent bar width
          const barWidth = calculatedHistWidth / bins.length;

          // get hovered flights for highlighting
          const hoveredFlightIds = yHoveredFlights?.toArray() || [];
          const hoveredFlightsData = hoveredFlightIds
            .map((id) => flightsToAnalyze.find((f) => f.id === id))
            .filter(Boolean) as Flight[];

          // bars
          histGroup
            .selectAll('rect')
            .data(bins)
            .join('rect')
            .attr('x', (d, i) => i * barWidth)
            .attr('width', barWidth - 1) // subtract 1 for spacing between bars
            .attr('y', (d) => yScale(d.length))
            .attr('height', (d) => histHeight - yScale(d.length))
            .attr('fill', (d) => {
              // check if any hovered flight's duration falls in this bin
              const binContainsHoveredFlight = hoveredFlightsData.some(
                (flight) => {
                  const binStart = d.x0!;
                  const binEnd = d.x1!;
                  // fix for edge values: use <= for the last bin to include max value
                  const isLastBin = bins.indexOf(d) === bins.length - 1;
                  return (
                    flight.duration >= binStart &&
                    (isLastBin
                      ? flight.duration <= binEnd
                      : flight.duration < binEnd)
                  );
                }
              );
              return binContainsHoveredFlight
                ? airportHighlightStroke
                : histogramBarFill;
            });

          // x-axis
          const numTicks = Math.min(bins.length, 4);
          const tickIndices = [];
          if (numTicks === 1) {
            tickIndices.push(0);
          } else {
            for (let i = 0; i < numTicks; i++) {
              tickIndices.push(
                Math.round((i * (bins.length - 1)) / (numTicks - 1))
              );
            }
          }

          const xAxis = d3
            .axisBottom(
              d3
                .scaleLinear()
                .range([0, calculatedHistWidth])
                .domain([0, bins.length - 1])
            )
            .tickValues(tickIndices)
            .tickFormat((d) => {
              const binIndex = Math.round(d as number);
              if (binIndex >= 0 && binIndex < bins.length) {
                const bin = bins[binIndex];
                const hours = (bin.x0! + bin.x1!) / 2;
                // show half-hour precision for better granularity
                return `${hours.toFixed(1)}h`;
              }
              return '';
            });

          histGroup
            .append('g')
            .attr('transform', `translate(0, ${histHeight})`)
            .call(xAxis)
            .call((g) =>
              g
                .selectAll('.tick')
                .attr(
                  'transform',
                  (d) =>
                    `translate(${(d as number) * barWidth + barWidth / 2}, 0)`
                )
            )
            .selectAll('text')
            .attr('fill', panelTextColor)
            .attr('font-size', '16px')
            .style('font-family', 'system-ui, sans-serif');

          histGroup.selectAll('path, line').attr('stroke', panelTextColor);

          currentHistY += 70; // increased from 50 to accommodate taller histograms
        }
      }

      // date histogram
      if (dates.length > 0) {
        const [minVal, maxVal] = d3.extent(dates);
        if (minVal !== undefined && maxVal !== undefined) {
          const histGroup = distributionsGroup
            .append('g')
            .attr('transform', `translate(${padding + 4}, ${currentHistY})`);

          const xScale = d3
            .scaleTime()
            .domain([minVal, maxVal])
            .range([0, calculatedHistWidth]);

          // calculate number of days between earliest and latest dates for bins
          const daysBetween =
            Math.ceil(
              (maxVal.getTime() - minVal.getTime()) / (1000 * 60 * 60 * 24)
            ) + 1;

          const histogram = d3
            .histogram<Date, Date>()
            .value((d) => d)
            .domain([minVal, maxVal])
            .thresholds(xScale.ticks(daysBetween));

          const bins = histogram(dates);
          const yMax = d3.max(bins, (d) => d.length) ?? 0;
          const yScale = d3
            .scaleLinear()
            .range([histHeight, 0])
            .domain([0, yMax]);

          // calculate consistent bar width
          const barWidth = calculatedHistWidth / bins.length;

          // get hovered flights for highlighting
          const hoveredFlightIds = yHoveredFlights?.toArray() || [];
          const hoveredFlightsData = hoveredFlightIds
            .map((id) => flightsToAnalyze.find((f) => f.id === id))
            .filter(Boolean) as Flight[];

          // bars
          histGroup
            .selectAll('rect')
            .data(bins)
            .join('rect')
            .attr('x', (d, i) => i * barWidth)
            .attr('width', barWidth - 1) // subtract 1 for spacing between bars
            .attr('y', (d) => yScale(d.length))
            .attr('height', (d) => histHeight - yScale(d.length))
            .attr('fill', (d) => {
              // check if any hovered flight's date falls in this bin
              const binContainsHoveredFlight = hoveredFlightsData.some(
                (flight) => {
                  // parse date as local date to avoid timezone issues
                  const dateParts = flight.date.split('-');
                  const flightDate = new Date(
                    parseInt(dateParts[0]),
                    parseInt(dateParts[1]) - 1,
                    parseInt(dateParts[2])
                  ).getTime();
                  const binStart = d.x0!.getTime();
                  const binEnd = d.x1!.getTime();
                  // fix for edge values: use <= for the last bin to include max value
                  const isLastBin = bins.indexOf(d) === bins.length - 1;
                  return (
                    flightDate >= binStart &&
                    (isLastBin ? flightDate <= binEnd : flightDate < binEnd)
                  );
                }
              );
              return binContainsHoveredFlight
                ? airportHighlightStroke
                : histogramBarFill;
            });

          // x-axis
          const numTicks = Math.min(bins.length, 4);
          const tickIndices = [];
          if (numTicks === 1) {
            tickIndices.push(0);
          } else {
            for (let i = 0; i < numTicks; i++) {
              tickIndices.push(
                Math.round((i * (bins.length - 1)) / (numTicks - 1))
              );
            }
          }

          const xAxis = d3
            .axisBottom(
              d3
                .scaleLinear()
                .range([0, calculatedHistWidth])
                .domain([0, bins.length - 1])
            )
            .tickValues(tickIndices)
            .tickFormat((d) => {
              const binIndex = Math.round(d as number);
              if (binIndex >= 0 && binIndex < bins.length) {
                const bin = bins[binIndex];
                const date = new Date(bin.x0!);
                return `${date.getMonth() + 1}/${date.getDate()}`;
              }
              return '';
            });

          histGroup
            .append('g')
            .attr('transform', `translate(0, ${histHeight})`)
            .call(xAxis)
            .call((g) =>
              g
                .selectAll('.tick')
                .attr(
                  'transform',
                  (d) =>
                    `translate(${(d as number) * barWidth + barWidth / 2}, 0)`
                )
            )
            .selectAll('text')
            .attr('fill', panelTextColor)
            .attr('font-size', '16px')
            .style('font-family', 'system-ui, sans-serif');

          histGroup.selectAll('path, line').attr('stroke', panelTextColor);
        }
      }
    }
  };

  // store projection ref for use in handlers
  const projectionRef = useRef<d3.GeoProjection | null>(null);
  // store interaction handler ref for adding/removing listener
  const interactionHandlerRef = useRef<EventListener | null>(null);

  // ref for airport quadtree
  const airportQuadtreeRef = useRef<QuadTree | null>(null);

  // ref for drag state of sticky brushes
  const dragStateRef = useRef<{
    left: {
      brushId: string | null;
      startX: number;
      startY: number;
    };
    right: {
      brushId: string | null;
      startX: number;
      startY: number;
    };
  }>({
    left: { brushId: null, startX: 0, startY: 0 },
    right: { brushId: null, startX: 0, startY: 0 },
  });

  useEffect(() => {
    if (
      !doc ||
      !syncStatus ||
      !svgRef.current ||
      !yWorldMapState ||
      !yHoveredAirportIATAsLeft ||
      !yHoveredAirportIATAsRight ||
      !ySelectedAirportIATAsLeft ||
      !ySelectedAirportIATAsRight ||
      !yPanelState
    ) {
      return undefined; // ensure a value is returned for cleanup path
    }

    const currentSvg = svgRef.current;
    const svg = d3.select(currentSvg);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    defs
      .append('filter')
      .attr('id', 'map-shadow')
      .append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 2)
      .attr('stdDeviation', 3)
      .attr('flood-opacity', 0.5);
    defs
      .append('filter')
      .attr('id', 'airport-shadow')
      .append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 1)
      .attr('stdDeviation', 2)
      .attr('flood-opacity', 0.75);

    const g = svg.append('g');
    gRef.current = g.node();

    // apply initial transform from yjs state or default
    const initialScale = (yWorldMapState.get('zoomScale') as number) || 1;
    const initialX = (yWorldMapState.get('panX') as number) || 0;
    const initialY = (yWorldMapState.get('panY') as number) || 0;
    transformRef.current = { k: initialScale, x: initialX, y: initialY };
    g.attr(
      'transform',
      `translate(${initialX},${initialY}) scale(${initialScale})`
    );

    let parentElementForListener: HTMLElement | null = null;

    Promise.all([
      d3.json<WorldTopology>('/src/assets/traveldata/world110.topo.json'),
      d3.json<Airport[]>('/src/assets/situationB/airports.json'),
      d3.json<Flight[]>('/src/assets/situationB/flights.json'),
      d3.json<PuzzleDescription>(
        '/src/assets/situationB/puzzle_description.json'
      ),
    ])
      .then(([topology, airportsData, flightsData, puzzleData]) => {
        if (
          !topology ||
          !topology.objects.countries ||
          !airportsData ||
          !flightsData ||
          !puzzleData
        ) {
          console.error('failed to load data.');
          return;
        }

        allFlights.current = flightsData;
        allAirports.current = airportsData; // store all airport data
        puzzleDescription.current = puzzleData; // store puzzle description data

        const geoFeature = topojson.feature(
          topology,
          topology.objects.countries
        ) as FeatureCollection<Geometry, CountryProperties>;

        const projection = d3
          .geoEqualEarth()
          .center([-75, 47])
          .translate([mapWidth / 2, totalHeight / 3.75])
          .scale(700);
        projectionRef.current = projection; // store projection
        const path = d3.geoPath().projection(projection);

        const mapGroup = g
          .append('g')
          .attr('class', 'map-features')
          .style('pointer-events', 'none')
          .style('filter', 'url(#map-shadow)');
        mapGroup
          .selectAll('path')
          .data(geoFeature.features)
          .join('path')
          .attr('d', path)
          .attr('fill', defaultFill)
          .attr('stroke', strokeColor)
          .attr('stroke-width', defaultStrokeWidth)
          .attr('class', 'country')
          .append('title')
          .text((d) => d.properties?.name ?? 'unknown');

        const airportsGroup = g
          .append('g')
          .attr('class', 'airports')
          .style('pointer-events', 'all')
          .style('filter', 'url(#airport-shadow)');

        airportsGroup
          .selectAll('circle')
          .data(airportsData) // use airportsData directly
          .join('circle')
          .attr('cx', (d) => {
            const coords = projection([d.Longitude, d.Latitude]);
            return coords ? coords[0] : 0;
          })
          .attr('cy', (d) => {
            const coords = projection([d.Longitude, d.Latitude]);
            return coords ? coords[1] : 0;
          })
          .attr('r', airportRadius / initialScale) // use initial scale
          .attr('fill', airportFill)
          .attr('stroke', airportStroke)
          .attr('stroke-width', airportStrokeWidth / initialScale) // use initial scale
          .attr('class', 'airport interactable') // add interactable class
          .attr('data-iata', (d) => d.IATA) // add iata for easy selection
          .append('title')
          .text((d) => `${d['Airport Name']} (${d.IATA})`);

        // sticky brushes group
        g.append('g').attr('class', 'sticky-brushes');

        // initial application of styles based on yjs state
        adjustStylesForTransform(initialScale);
        renderStickyBrushes(); // initial render
        redrawAllLinesFromYjs(projection);
        updateInfoPanelFromYjs();

        // interaction handler for custom gesture events
        const handleInteractionLogic = (event: InteractionEvent) => {
          if (
            !doc ||
            !gRef.current ||
            !yWorldMapState ||
            !yHoveredAirportIATAsLeft ||
            !yHoveredAirportIATAsRight
          )
            return;

          let targetElement: SVGElement | null = null;
          let handedness: 'left' | 'right' | undefined;

          // type guard for events that carry element and handedness
          if (
            event.type === 'pointerover' ||
            event.type === 'pointerout' ||
            event.type === 'pointerselect' ||
            event.type === 'pointerdown' ||
            event.type === 'pointermove' ||
            event.type === 'pointerup'
          ) {
            const pointerEvent = event as InteractionEvent & {
              element?: Element;
              handedness?: 'left' | 'right';
            }; // more specific type assertion
            if (pointerEvent.element instanceof SVGElement) {
              targetElement = pointerEvent.element;
            }
            handedness = pointerEvent.handedness;
          }

          const airportIATA = targetElement
            ?.closest('.airport')
            ?.getAttribute('data-iata');

          // check for sticky brush element
          const brushElement = targetElement?.closest('.sticky-brush');
          const brushId = brushElement?.getAttribute('data-brush-id');

          // check for flight element (could be the rect itself or its parent group)
          const flightElement =
            targetElement?.closest('.flight-item') ||
            (targetElement?.getAttribute('data-flight-id')
              ? targetElement
              : null);
          const flightId = flightElement?.getAttribute('data-flight-id');

          // handle custom events outside the switch
          if (event.type === 'createStickyBrush') {
            doc.transact(() => {
              const brushEvent = event as CreateStickyBrushEvent;
              if (brushEvent.brush && yStickyBrushes) {
                const { brush } = brushEvent;
                const currentTransform = transformRef.current;

                // get svg element's bounding box to correctly calculate coordinates
                const svgRect = svgRef.current?.getBoundingClientRect();
                if (!svgRect) return;

                // convert client coordinates to svg-relative coordinates
                const pointInSvgSpace: [number, number] = [
                  brush.center.x - svgRect.left,
                  brush.center.y - svgRect.top,
                ];

                // convert svg-relative coordinates to svg's internal coordinate system
                const svgPoint = d3.zoomIdentity
                  .translate(currentTransform.x, currentTransform.y)
                  .scale(currentTransform.k)
                  .invert(pointInSvgSpace);

                const newBrush: StickyBrush = {
                  id: `brush-${Date.now()}-${Math.random()}`,
                  x: svgPoint[0],
                  y: svgPoint[1],
                  radius: brush.radius / currentTransform.k,
                  type:
                    brushEvent.handedness === 'left' ? 'origin' : 'destination',
                };
                yStickyBrushes.push([newBrush]);
              }
            });
            return; // end here for this event type
          }

          doc.transact(() => {
            switch (event.type) {
              case 'pointerover':
                // handle airport hover
                if (
                  airportIATA &&
                  handedness &&
                  yWorldMapState &&
                  yHoveredAirportIATAsLeft &&
                  yHoveredAirportIATAsRight
                ) {
                  const targetArray =
                    handedness === 'left'
                      ? yHoveredAirportIATAsLeft
                      : yHoveredAirportIATAsRight;
                  const oppositeHoveredArray =
                    handedness === 'left'
                      ? yHoveredAirportIATAsRight
                      : yHoveredAirportIATAsLeft;
                  const oppositeSelectedArray =
                    handedness === 'left'
                      ? ySelectedAirportIATAsRight
                      : ySelectedAirportIATAsLeft;

                  // check if airport is already in opposite group (hovered or selected)
                  const isInOppositeGroup =
                    oppositeHoveredArray.toArray().includes(airportIATA) ||
                    oppositeSelectedArray.toArray().includes(airportIATA);

                  if (
                    !targetArray.toArray().includes(airportIATA) &&
                    !isInOppositeGroup
                  ) {
                    targetArray.push([airportIATA]);
                  }
                }
                // handle flight hover
                else if (flightId && yHoveredFlights) {
                  const flightIdNum = parseInt(flightId, 10);
                  if (!yHoveredFlights.toArray().includes(flightIdNum)) {
                    // allow multiple flights to be hovered simultaneously
                    yHoveredFlights.push([flightIdNum]);
                  }
                }
                break;

              case 'pointerout':
                // handle airport hover out
                if (
                  airportIATA &&
                  handedness &&
                  yWorldMapState &&
                  yHoveredAirportIATAsLeft &&
                  yHoveredAirportIATAsRight &&
                  ySelectedAirportIATAsLeft &&
                  ySelectedAirportIATAsRight
                ) {
                  const targetArray =
                    handedness === 'left'
                      ? yHoveredAirportIATAsLeft
                      : yHoveredAirportIATAsRight;
                  const targetSelectedArray =
                    handedness === 'left'
                      ? ySelectedAirportIATAsLeft
                      : ySelectedAirportIATAsRight;
                  const index = targetArray.toArray().indexOf(airportIATA);
                  if (index > -1) {
                    // only remove if not currently selected by this hand for stickiness
                    if (!targetSelectedArray.toArray().includes(airportIATA)) {
                      targetArray.delete(index, 1);
                    }
                  }
                }
                // handle flight hover out
                else if (flightId && yHoveredFlights) {
                  const flightIdNum = parseInt(flightId, 10);
                  const index = yHoveredFlights.toArray().indexOf(flightIdNum);
                  if (index > -1) {
                    yHoveredFlights.delete(index, 1);
                  }
                }
                break;

              case 'pointerselect':
                if (
                  airportIATA &&
                  handedness &&
                  yWorldMapState &&
                  yHoveredAirportIATAsLeft &&
                  yHoveredAirportIATAsRight &&
                  ySelectedAirportIATAsLeft &&
                  ySelectedAirportIATAsRight
                ) {
                  const targetSelectionArray =
                    handedness === 'left'
                      ? ySelectedAirportIATAsLeft
                      : ySelectedAirportIATAsRight;
                  const oppositeSelectionArray =
                    handedness === 'left'
                      ? ySelectedAirportIATAsRight
                      : ySelectedAirportIATAsLeft;
                  const targetHoveredArray =
                    handedness === 'left'
                      ? yHoveredAirportIATAsLeft
                      : yHoveredAirportIATAsRight;
                  const oppositeHoveredArray =
                    handedness === 'left'
                      ? yHoveredAirportIATAsRight
                      : yHoveredAirportIATAsLeft;

                  const currentSelectedIndex = targetSelectionArray
                    .toArray()
                    .indexOf(airportIATA);

                  if (currentSelectedIndex > -1) {
                    // airport is already selected by this hand, so deselect it
                    targetSelectionArray.delete(currentSelectedIndex, 1);
                  } else {
                    // check if airport is selected in opposite group
                    const oppositeSelectedIndex = oppositeSelectionArray
                      .toArray()
                      .indexOf(airportIATA);

                    if (oppositeSelectedIndex > -1) {
                      // airport is selected in opposite group, so move it to this group
                      oppositeSelectionArray.delete(oppositeSelectedIndex, 1);
                      targetSelectionArray.push([airportIATA]);
                      // remove from both hovered arrays since it's now pinned
                      const targetHoveredIndex = targetHoveredArray
                        .toArray()
                        .indexOf(airportIATA);
                      if (targetHoveredIndex > -1) {
                        targetHoveredArray.delete(targetHoveredIndex, 1);
                      }
                      const oppositeHoveredIndex = oppositeHoveredArray
                        .toArray()
                        .indexOf(airportIATA);
                      if (oppositeHoveredIndex > -1) {
                        oppositeHoveredArray.delete(oppositeHoveredIndex, 1);
                      }
                    } else {
                      // check if airport is only hovered in opposite group
                      const isHoveredInOppositeGroup = oppositeHoveredArray
                        .toArray()
                        .includes(airportIATA);

                      if (!isHoveredInOppositeGroup) {
                        // airport is not in opposite group at all, so select it
                        targetSelectionArray.push([airportIATA]);
                        // remove from current hovered array since it's now pinned
                        const targetHoveredIndex = targetHoveredArray
                          .toArray()
                          .indexOf(airportIATA);
                        if (targetHoveredIndex > -1) {
                          targetHoveredArray.delete(targetHoveredIndex, 1);
                        }
                      }
                      // if airport is only hovered in opposite group, do nothing
                    }
                  }
                }
                // handle flight selection (pinning)
                else if (flightId && ySelectedFlights) {
                  const flightIdNum = parseInt(flightId, 10);
                  const currentSelectedFlights = ySelectedFlights.toArray();
                  const currentSelectedIndex =
                    currentSelectedFlights.indexOf(flightIdNum);

                  if (currentSelectedIndex > -1) {
                    // flight is already selected, so deselect it
                    ySelectedFlights.delete(currentSelectedIndex, 1);
                  } else {
                    // flight is not selected, so select it (with maximum of 2)
                    if (currentSelectedFlights.length >= 2) {
                      // remove the oldest selected flight to make room for the new one
                      ySelectedFlights.delete(0, 1);
                    }
                    ySelectedFlights.push([flightIdNum]);
                  }
                }
                // handle sticky brush deletion
                else if (brushId && yStickyBrushes) {
                  const brushIndex = yStickyBrushes
                    .toArray()
                    .findIndex((b) => b.id === brushId);
                  if (brushIndex > -1) {
                    yStickyBrushes.delete(brushIndex, 1);
                  }
                }
                break;

              case 'drag':
                if (event.transform && yWorldMapState) {
                  yWorldMapState.set('panX', event.transform.x);
                  yWorldMapState.set('panY', event.transform.y);
                  // k (scale) is not changed by drag in this setup
                }
                break;

              case 'zoom':
                if (event.transform && yWorldMapState) {
                  yWorldMapState.set('panX', event.transform.x);
                  yWorldMapState.set('panY', event.transform.y);
                  yWorldMapState.set('zoomScale', event.transform.scale);
                }
                break;

              case 'pointerdown': {
                // handle start of scroll operation for flights list
                const { point, handedness, element } = event;

                // check if starting a drag on a sticky brush
                if (
                  brushId &&
                  point &&
                  handedness &&
                  dragStateRef.current[handedness]
                ) {
                  dragStateRef.current[handedness] = {
                    brushId,
                    startX: point.clientX,
                    startY: point.clientY,
                  };
                  return; // consume event
                }

                if (!handedness || !element) return;

                // check if the element is within the interactable panel
                if (
                  element &&
                  (element === panelSvgRef.current ||
                    panelSvgRef.current?.contains(element)) &&
                  yPanelState
                ) {
                  const scrollState = scrollDragStateRef.current[handedness];
                  scrollState.active = true;
                  scrollState.startY = point.clientY;
                  const currentScroll =
                    (yPanelState.get('flightsScrollY') as number) || 0;
                  scrollState.startScrollTop = currentScroll;
                }
                break;
              }

              case 'pointermove': {
                // handle scroll movement for flights list
                const { point, handedness } = event;

                // handle sticky brush drag
                if (handedness && dragStateRef.current[handedness]?.brushId) {
                  const dragState = dragStateRef.current[handedness];
                  if (dragState.brushId && point && yStickyBrushes) {
                    const brush = yStickyBrushes
                      .toArray()
                      .find((b) => b.id === dragState.brushId);
                    if (brush) {
                      const dx = point.clientX - dragState.startX;
                      const dy = point.clientY - dragState.startY;
                      const scale = transformRef.current.k;

                      // find brush index to update it
                      const brushIndex = yStickyBrushes
                        .toArray()
                        .indexOf(brush);
                      if (brushIndex > -1) {
                        const updatedBrush: StickyBrush = {
                          ...brush,
                          x: brush.x + dx / scale,
                          y: brush.y + dy / scale,
                        };
                        yStickyBrushes.delete(brushIndex, 1);
                        yStickyBrushes.insert(brushIndex, [updatedBrush]);

                        // update start position for next move event
                        dragState.startX = point.clientX;
                        dragState.startY = point.clientY;
                      }
                    }
                    return; // consume event
                  }
                }

                if (!handedness) return;

                const scrollState = scrollDragStateRef.current[handedness];
                if (scrollState.active && yPanelState) {
                  const deltaY = point.clientY - scrollState.startY;
                  // invert the delta to make dragging down scroll down (natural scrolling)
                  const newScrollTop = scrollState.startScrollTop - deltaY;

                  // calculate filtered flights count for scroll limit
                  const hoveredLeftIATAsForScroll =
                    yHoveredAirportIATAsLeft?.toArray() || [];
                  const hoveredRightIATAsForScroll =
                    yHoveredAirportIATAsRight?.toArray() || [];
                  const selectedLeftIATAsForScroll =
                    ySelectedAirportIATAsLeft?.toArray() || [];
                  const selectedRightIATAsForScroll =
                    ySelectedAirportIATAsRight?.toArray() || [];
                  const originStickyHoverIATAsForScroll =
                    yHoveredByOriginBrushes?.toArray() || [];
                  const destinationStickyHoverIATAsForScroll =
                    yHoveredByDestinationBrushes?.toArray() || [];

                  const leftFilterIATAsForScroll = Array.from(
                    new Set([
                      ...selectedLeftIATAsForScroll,
                      ...hoveredLeftIATAsForScroll,
                      ...originStickyHoverIATAsForScroll,
                    ])
                  );
                  const rightFilterIATAsForScroll = Array.from(
                    new Set([
                      ...selectedRightIATAsForScroll,
                      ...hoveredRightIATAsForScroll,
                      ...destinationStickyHoverIATAsForScroll,
                    ])
                  );

                  let filteredFlightsCount = 0;
                  if (
                    leftFilterIATAsForScroll.length > 0 &&
                    rightFilterIATAsForScroll.length > 0
                  ) {
                    filteredFlightsCount = allFlights.current.filter(
                      (flight) =>
                        leftFilterIATAsForScroll.includes(flight.origin) &&
                        rightFilterIATAsForScroll.includes(flight.destination)
                    ).length;
                  } else if (leftFilterIATAsForScroll.length > 0) {
                    filteredFlightsCount = allFlights.current.filter((flight) =>
                      leftFilterIATAsForScroll.includes(flight.origin)
                    ).length;
                  } else if (rightFilterIATAsForScroll.length > 0) {
                    filteredFlightsCount = allFlights.current.filter((flight) =>
                      rightFilterIATAsForScroll.includes(flight.destination)
                    ).length;
                  }

                  // clamp scroll position to valid range
                  // calculate flights content height for proper scroll bounds
                  const paddingForScroll = 6;
                  const sectionGapForScroll = 12;
                  const titleHeightForScroll = 20;
                  const itemHeightForScroll = 35;
                  const maxItemsForScroll = 4;
                  const bottomPaddingForScroll = 10;
                  const distributionsFixedHeightForScroll = 10 + 3 * 70; // same as calculated earlier
                  const selectionsYForScroll = paddingForScroll;
                  const boxHeightForScroll =
                    titleHeightForScroll +
                    25 +
                    maxItemsForScroll * itemHeightForScroll -
                    bottomPaddingForScroll; // replicate box height calculation
                  const flightsYForScroll =
                    selectionsYForScroll +
                    boxHeightForScroll +
                    sectionGapForScroll;
                  const flightsContentYForScroll = flightsYForScroll + 10;
                  const flightsContentHeightForScroll =
                    totalHeight -
                    flightsContentYForScroll -
                    distributionsFixedHeightForScroll -
                    sectionGapForScroll -
                    paddingForScroll;

                  const maxScroll = Math.max(
                    0,
                    filteredFlightsCount * 80 - flightsContentHeightForScroll
                  );
                  const clampedScrollTop = Math.max(
                    0,
                    Math.min(maxScroll, newScrollTop)
                  );

                  yPanelState.set('flightsScrollY', clampedScrollTop);
                }
                break;
              }

              case 'pointerup': {
                // handle end of scroll operation for flights list
                const { handedness } = event;

                if (handedness) {
                  // end sticky brush drag
                  if (dragStateRef.current[handedness]?.brushId) {
                    dragStateRef.current[handedness].brushId = null;
                    return; // consume event
                  }

                  // handle end of scroll operation for flights list
                  const scrollState = scrollDragStateRef.current[handedness];
                  if (scrollState.active) {
                    scrollState.active = false;
                  }
                }
                break;
              }
            }
          });
        };

        parentElementForListener = currentSvg.parentElement;
        if (parentElementForListener) {
          // store the handler in a ref so it can be removed with the same reference
          interactionHandlerRef.current = ((e: CustomEvent<InteractionEvent>) =>
            handleInteractionLogic(e.detail)) as EventListener;
          parentElementForListener.addEventListener(
            'interaction',
            interactionHandlerRef.current
          );
        }
      })
      .catch((error) =>
        console.error('error loading or processing data:', error)
      );

    // setup observers for yjs changes to reflect in d3
    const yjsObserver = () => {
      const currentProj = projectionRef.current;
      if (
        !currentProj ||
        !yWorldMapState ||
        !yHoveredAirportIATAsLeft ||
        !yHoveredAirportIATAsRight
      )
        return;
      adjustStylesForTransform(transformRef.current.k); // re-apply styles based on current known scale
      redrawAllLinesFromYjs(currentProj);
      updateInfoPanelFromYjs();
    };

    yHoveredAirportIATAsLeft.observeDeep(yjsObserver);
    yHoveredAirportIATAsRight.observeDeep(yjsObserver);
    ySelectedAirportIATAsLeft.observeDeep(yjsObserver);
    ySelectedAirportIATAsRight.observeDeep(yjsObserver);
    yPanelState.observeDeep(yjsObserver); // observe panel state changes
    yHoveredFlights?.observeDeep(yjsObserver); // observe hovered flights changes
    ySelectedFlights?.observeDeep(yjsObserver); // observe selected flights changes
    yStickyBrushes?.observeDeep(renderStickyBrushes); // observe sticky brushes changes
    yHoveredByOriginBrushes?.observeDeep(yjsObserver); // re-run observers when sticky hovers change
    yHoveredByDestinationBrushes?.observeDeep(yjsObserver); // re-run observers when sticky hovers change

    // animation loop for sticky brush hover detection
    const hoverAnimationLoop = () => {
      if (
        !gRef.current ||
        !yStickyBrushes ||
        !yHoveredByOriginBrushes ||
        !yHoveredByDestinationBrushes ||
        !doc
      ) {
        animationFrameRef.current = requestAnimationFrame(hoverAnimationLoop);
        return;
      }

      // build quadtree on each frame for simplicity, could be optimized
      // to only rebuild on zoom/pan if performance becomes an issue.
      // the bounds should encompass the entire possible coordinate space of airports.
      // using a large fixed size based on projection is a safe bet.
      const quadtreeBounds: QuadTreeBounds = {
        x: -totalWidth * 2,
        y: -totalHeight * 2,
        width: totalWidth * 4,
        height: totalHeight * 4,
      };
      const airportQuadtree = new QuadTree(quadtreeBounds);
      const allAirportsElements = d3
        .select(gRef.current)
        .selectAll<SVGCircleElement, Airport>('circle.airport')
        .nodes();

      allAirportsElements.forEach((el) => {
        const cx = parseFloat(el.getAttribute('cx') || '0');
        const cy = parseFloat(el.getAttribute('cy') || '0');
        const r = parseFloat(el.getAttribute('r') || '0');
        airportQuadtree.insert({
          element: el,
          bounds: { x: cx - r, y: cy - r, width: r * 2, height: r * 2 },
        });
      });
      airportQuadtreeRef.current = airportQuadtree;

      const brushes = yStickyBrushes.toArray();
      const originHoveredIATAs = new Set<string>();
      const destinationHoveredIATAs = new Set<string>();

      for (const brush of brushes) {
        const brushCenter = { x: brush.x, y: brush.y };
        const hoveredElements = airportQuadtreeRef.current.queryCircle(
          brushCenter,
          brush.radius
        );

        for (const airportElement of hoveredElements) {
          const airportData = d3
            .select(airportElement as SVGCircleElement)
            .datum() as Airport;
          if (airportData) {
            if (brush.type === 'origin') {
              originHoveredIATAs.add(airportData.IATA);
            } else {
              destinationHoveredIATAs.add(airportData.IATA);
            }
          }
        }
      }

      const currentOriginHovered = new Set(yHoveredByOriginBrushes.toArray());
      const newOriginHoveredArray = Array.from(originHoveredIATAs);

      const currentDestinationHovered = new Set(
        yHoveredByDestinationBrushes.toArray()
      );
      const newDestinationHoveredArray = Array.from(destinationHoveredIATAs);

      // update yjs array only if there's a change
      if (
        JSON.stringify(Array.from(currentOriginHovered).sort()) !==
          JSON.stringify(newOriginHoveredArray.sort()) ||
        JSON.stringify(Array.from(currentDestinationHovered).sort()) !==
          JSON.stringify(newDestinationHoveredArray.sort())
      ) {
        doc.transact(() => {
          if (yHoveredByOriginBrushes) {
            yHoveredByOriginBrushes.delete(0, yHoveredByOriginBrushes.length);
            yHoveredByOriginBrushes.push(newOriginHoveredArray);
          }
          if (yHoveredByDestinationBrushes) {
            yHoveredByDestinationBrushes.delete(
              0,
              yHoveredByDestinationBrushes.length
            );
            yHoveredByDestinationBrushes.push(newDestinationHoveredArray);
          }
        });
      }

      animationFrameRef.current = requestAnimationFrame(hoverAnimationLoop);
    };

    animationFrameRef.current = requestAnimationFrame(hoverAnimationLoop);

    // main effect cleanup
    return () => {
      if (animationFrameRef.current)
        cancelAnimationFrame(animationFrameRef.current);
      clearAllLines();

      // clean up panel svg content
      if (panelSvgRef.current) {
        const panelSvg = d3.select(panelSvgRef.current);
        panelSvg.selectAll('g.panel-content').remove();
        panelSvg.select('defs').selectAll('clipPath[id^="flights-"]').remove();
      }

      yHoveredAirportIATAsLeft?.unobserveDeep(yjsObserver);
      yHoveredAirportIATAsRight?.unobserveDeep(yjsObserver);
      ySelectedAirportIATAsLeft?.unobserveDeep(yjsObserver);
      ySelectedAirportIATAsRight?.unobserveDeep(yjsObserver);
      yPanelState?.unobserveDeep(yjsObserver); // unobserve panel state changes
      yHoveredFlights?.unobserveDeep(yjsObserver); // unobserve hovered flights changes
      ySelectedFlights?.unobserveDeep(yjsObserver); // unobserve selected flights changes
      yStickyBrushes?.unobserveDeep(renderStickyBrushes); // unobserve sticky brushes
      yHoveredByOriginBrushes?.unobserveDeep(yjsObserver);
      yHoveredByDestinationBrushes?.unobserveDeep(yjsObserver);

      // cleanup scroll drag state
      scrollDragStateRef.current.left.active = false;
      scrollDragStateRef.current.right.active = false;

      // cleanup interaction listener
      if (parentElementForListener && interactionHandlerRef.current) {
        parentElementForListener.removeEventListener(
          'interaction',
          interactionHandlerRef.current
        );
        interactionHandlerRef.current = null; // clear the ref
      }
    };
  }, [
    doc,
    syncStatus,
    yWorldMapState,
    yHoveredAirportIATAsLeft,
    yHoveredAirportIATAsRight,
    ySelectedAirportIATAsLeft,
    ySelectedAirportIATAsRight,
    yPanelState,
    yHoveredFlights,
    ySelectedFlights,
    yStickyBrushes,
    yHoveredByOriginBrushes,
    yHoveredByDestinationBrushes,
  ]);

  // function to draw pinned flight lines (always visible in green)
  const drawPinnedFlightLines = (projection: d3.GeoProjection | null) => {
    if (!projection || !ySelectedFlights) return;

    const selectedFlights = ySelectedFlights.toArray();
    const selectedFlightData = selectedFlights
      .map((id) => allFlights.current.find((f) => f.id === id))
      .filter(Boolean) as Flight[];

    selectedFlightData.forEach((flight) => {
      const pairKey = getPairKey(flight.origin, flight.destination);
      // only draw if this line doesn't already exist
      if (!activeLinesByPair.current.has(pairKey)) {
        drawAirportLineByIATAs(
          flight.origin,
          flight.destination,
          projection,
          false,
          true
        );
      }
    });
  };

  // function to render sticky brushes
  const renderStickyBrushes = () => {
    if (!gRef.current || !yStickyBrushes) return;

    const brushesGroup = d3.select(gRef.current).select('.sticky-brushes');
    const brushes = yStickyBrushes.toArray();

    brushesGroup
      .selectAll<SVGCircleElement, StickyBrush>('.sticky-brush')
      .data(brushes, (d: StickyBrush) => d.id)
      .join(
        (enter) =>
          enter
            .append('circle')
            .attr('class', 'sticky-brush interactable draggable')
            .attr('data-brush-id', (d) => d.id)
            .attr('cx', (d) => d.x)
            .attr('cy', (d) => d.y)
            .attr('r', (d) => d.radius)
            .attr('fill', (d) =>
              d.type === 'origin'
                ? 'rgba(255, 182, 193, 0.3)'
                : 'rgba(173, 216, 230, 0.3)'
            )
            .attr('stroke', (d) =>
              d.type === 'origin'
                ? airportSelectedLeftStroke
                : airportSelectedRightStroke
            )
            .attr('stroke-width', 3 / transformRef.current.k),
        (update) =>
          update
            .attr('cx', (d) => d.x)
            .attr('cy', (d) => d.y)
            .attr('r', (d) => d.radius)
            .attr('stroke-width', 3 / transformRef.current.k),
        (exit) => exit.remove()
      );
  };

  if (
    !syncStatus ||
    !doc ||
    !ySelectedAirportIATAsLeft ||
    !ySelectedAirportIATAsRight
  ) {
    // ensure doc is also available for initial render
    return (
      <div
        style={{
          width: '100%', // Use 100% to fill parent like Senate
          height: '100%', // Use 100% to fill parent like Senate
          position: 'relative', // Relative for potential inner absolute elements
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'transparent', // Match Senate
          overflow: 'hidden', // Match Senate
          borderRadius: '8px', // Match Senate
          boxShadow: 'inset 0 0 10px rgba(0,0,0,0.05)', // Match Senate
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
            background: 'rgba(255,255,255,0.8)', // Match Senate
            borderRadius: '12px', // Match Senate
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)', // Match Senate
          }}
        >
          <div
            style={{
              fontSize: '2rem',
              marginBottom: '0.5rem',
              fontWeight: 500,
              color: '#333', // Match Senate
            }}
          >
            Travel Map Visualization
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              marginBottom: '1.5rem',
              color: '#555', // Match Senate
            }}
          >
            waiting for synchronization...
          </div>
          <div
            style={{
              marginTop: '1rem',
              width: '100%',
              height: '6px',
              background: '#eee', // Match Senate
              borderRadius: '8px', // Match Senate
              overflow: 'hidden', // Match Senate
            }}
          >
            <div
              style={{
                width: '40%',
                height: '100%',
                background: `linear-gradient(to right, #1E90FF, #1E90FF)`, // Adjusted color for WorldMap theme
                animation: 'progressAnimation 2s infinite',
                borderRadius: '8px', // Match Senate
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
    <>
      <svg
        ref={svgRef}
        width='100%'
        height='100%'
        style={{
          pointerEvents: 'all',
          touchAction: 'none',
          position: 'relative',
          cursor: 'pointer',
          overflow: 'hidden',
        }}
      />
      {/* info panel svg structure */}
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
      </svg>

      {/* validation indicator in top right */}
      {ySelectedFlights && ySelectedFlights.toArray().length === 2 && (
        <div
          style={{
            position: 'fixed',
            top: '0px',
            right: '0px',
            zIndex: 1001,
            background: validationResult.isValid ? '#16a34a' : '#f43f5e',
            color: 'white',
            padding: '16px 20px',
            borderRadius: '0 0 0 12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            maxWidth: '320px',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {validationResult.isValid ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '24px' }}>✅</div>
              <div>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: '600',
                    marginBottom: '4px',
                  }}
                >
                  Valid Solution!
                </div>
                <div style={{ fontSize: '14px', opacity: 0.9 }}>
                  congratulations! you found a matching flight pair.
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div
                style={{
                  fontSize: '18px',
                  fontWeight: '600',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span style={{ fontSize: '20px' }}>❌</span>
                solution invalid
              </div>
              <div style={{ fontSize: '14px', lineHeight: '1.4' }}>
                {validationResult.failedCriteria.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: '16px' }}>
                    {validationResult.failedCriteria.map((criteria, index) => (
                      <li key={index} style={{ marginBottom: '4px' }}>
                        {criteria}
                      </li>
                    ))}
                  </ul>
                ) : (
                  'select exactly 2 flights to validate.'
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default TravelTask;
