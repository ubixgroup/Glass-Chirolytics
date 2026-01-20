import React, { useContext, useEffect, useRef, useState } from 'react';
import { YjsContext } from '@/context/YjsContext';
import * as d3 from 'd3';
import penguinsUrl from '@/assets/splom/penguins50.csv?url';
import { GetCurrentTransformFn } from '@/utils/interactionHandlers';
import { InteractionEvent } from '@/types/interactionTypes';

// typescript interface for a penguin record
interface PenguinRow {
  rowid: string;
  species: string;
  island: string;
  bill_length_mm?: number;
  bill_depth_mm?: number;
  flipper_length_mm?: number;
  body_mass_g?: number;
  sex?: string | null;
  year?: number;
}

// props interface for the splom component
interface SplomProps {
  getCurrentTransformRef: React.MutableRefObject<GetCurrentTransformFn | null>;
}

// helper to convert csv fields to numeric while handling 'NA'
function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (value === 'NA' || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const Splom: React.FC<SplomProps> = ({ getCurrentTransformRef }) => {
  // yjs context for shared transform state
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;

  // container ref for d3
  const d3Container = useRef<HTMLDivElement | null>(null);

  // shared map for pan/zoom state
  // include string[] to store hovered row ids across clients for linked highlighting
  const ySharedState = doc!.getMap<string | number | string[]>(
    'splomSharedState'
  );

  // track sync state
  const [syncStatus, setSyncStatus] = useState<boolean>(false);
  const [userId] = useState<string>(() => crypto.randomUUID());

  // current transform refs
  const [currentTransform, setCurrentTransform] = useState<d3.ZoomTransform>(
    d3.zoomIdentity
  );
  const transformRef = useRef<{ k: number; x: number; y: number }>({
    k: 1,
    x: 0,
    y: 0,
  });

  // data state
  const [data, setData] = useState<PenguinRow[]>([]);

  // track previously highlighted rows to minimize dom churn
  const prevHoveredRowsRef = useRef<Set<string>>(new Set());

  // fixed canvas size
  const fixedWidth = 1280;
  const fixedHeight = 720;

  // per-client hover rows map (keyed by userid) to support concurrent users
  const yClientHoverRows = doc!.getMap<string[]>('clientHoverSplomRows');

  // expose current transform for gesture handlers
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

  // assume sync after small delay
  useEffect(() => {
    if (!doc) return;
    const timeout = setTimeout(() => {
      setSyncStatus(true);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [doc]);

  // load penguins data
  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      const rows = await d3.csv(penguinsUrl, (d) => {
        const row: PenguinRow = {
          rowid: String(d.rowid ?? ''),
          species: String(d.species ?? ''),
          island: String(d.island ?? ''),
          bill_length_mm: toNumber(d.bill_length_mm as string | undefined),
          bill_depth_mm: toNumber(d.bill_depth_mm as string | undefined),
          flipper_length_mm: toNumber(
            d.flipper_length_mm as string | undefined
          ),
          body_mass_g: toNumber(d.body_mass_g as string | undefined),
          sex: d.sex === 'NA' ? null : ((d.sex as string | undefined) ?? null),
          year: toNumber(d.year as string | undefined),
        };
        return row;
      });
      // filter out rows missing any of the numeric features so the splom behaves like the d3 example
      const filtered = rows.filter(
        (r) =>
          r.bill_length_mm !== undefined &&
          r.bill_depth_mm !== undefined &&
          r.flipper_length_mm !== undefined &&
          r.body_mass_g !== undefined
      );
      if (isMounted) setData(filtered);
    };
    load().catch(console.error);
    return () => {
      isMounted = false;
    };
  }, []);

  // sync transform from yjs
  useEffect(() => {
    if (!doc || !syncStatus) return;
    const initial = {
      k: (ySharedState.get('zoomScale') as number) || 1,
      x: (ySharedState.get('panX') as number) || 0,
      y: (ySharedState.get('panY') as number) || 0,
    };
    transformRef.current = initial;
    setCurrentTransform(
      d3.zoomIdentity.translate(initial.x, initial.y).scale(initial.k)
    );

    const observer = () => {
      const scale = (ySharedState.get('zoomScale') as number) || 1;
      const x = (ySharedState.get('panX') as number) || 0;
      const y = (ySharedState.get('panY') as number) || 0;

      // update transform if changed
      if (
        scale !== transformRef.current.k ||
        x !== transformRef.current.x ||
        y !== transformRef.current.y
      ) {
        transformRef.current = { k: scale, x, y };
        setCurrentTransform(d3.zoomIdentity.translate(x, y).scale(scale));
        const rootSel = d3.select('#splom-root');
        if (!rootSel.empty()) {
          rootSel.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
        }
      }

      // apply hover highlights from per-client hover map
      const root = d3.select('#splom-root');
      if (!root.empty()) {
        const hoveredIds: string[] = [];
        yClientHoverRows.forEach((ids: string[]) => {
          if (Array.isArray(ids)) hoveredIds.push(...ids);
        });
        const current = new Set<string>(hoveredIds);
        const prev = prevHoveredRowsRef.current;

        root.classed('splom-highlight-active', current.size > 0);

        // add new highlights
        current.forEach((rid) => {
          if (!prev.has(rid)) {
            root
              .selectAll(`circle.splom-point[data-rowid='${rid}']`)
              .classed('highlighted', true);
          }
        });

        // remove old highlights
        prev.forEach((rid) => {
          if (!current.has(rid)) {
            root
              .selectAll(`circle.splom-point[data-rowid='${rid}']`)
              .classed('highlighted', false);
          }
        });

        prevHoveredRowsRef.current = current;
      }
    };
    ySharedState.observe(observer);
    yClientHoverRows.observe(observer);
    return () => {
      ySharedState.unobserve(observer);
      yClientHoverRows.unobserve(observer);
    };
  }, [doc, syncStatus, ySharedState, yClientHoverRows]);

  // d3 rendering
  useEffect(() => {
    if (!syncStatus || !d3Container.current) return;
    if (data.length === 0) return;

    // clear container
    d3.select(d3Container.current).selectAll('*').remove();

    // create svg
    const svg = d3
      .select(d3Container.current)
      .append('svg')
      .attr('width', fixedWidth)
      .attr('height', fixedHeight)
      .attr('viewBox', [0, 0, fixedWidth, fixedHeight])
      .attr('style', 'background: transparent; max-width: 100%; height: auto;')
      .attr('class', 'interactable');

    // svg defs for text drop shadows
    const defs = svg.append('defs');
    defs
      .append('filter')
      .attr('id', 'splomTextShadow')
      .append('feDropShadow')
      .attr('dx', 0.5)
      .attr('dy', 0.5)
      .attr('stdDeviation', 0.75)
      .attr('flood-color', '#000')
      .attr('flood-opacity', 0.35);

    // css for fast highlight
    svg.append('style').text(`
      .splom-highlight-active g.points circle { opacity: 0.08; }
      .splom-highlight-active g.points circle.highlighted { opacity: 1; }
    `);

    // initial transform
    const initialScale = (ySharedState.get('zoomScale') as number) || 1;
    const initialX = (ySharedState.get('panX') as number) || 0;
    const initialY = (ySharedState.get('panY') as number) || 0;
    transformRef.current = { k: initialScale, x: initialX, y: initialY };

    // root group
    const root = svg
      .append('g')
      .attr('class', 'root')
      .attr('id', 'splom-root')
      .attr(
        'transform',
        `translate(${initialX}, ${initialY}) scale(${initialScale})`
      );

    // prepare variables and scales
    // keep only the top-left 2x2 of the original 4x4 matrix by selecting the first two variables
    const allVariables: Array<keyof PenguinRow> = [
      'bill_length_mm',
      'bill_depth_mm',
      'flipper_length_mm',
      'body_mass_g',
    ];
    const variables: Array<keyof PenguinRow> = allVariables.slice(0, 2);
    const n = variables.length;

    // layout
    const margin = { top: 40, right: 20, bottom: 30, left: 40 };
    const size = Math.min(
      Math.floor((fixedWidth - margin.left - margin.right) / n),
      Math.floor((fixedHeight - margin.top - margin.bottom) / n)
    );
    const x = new Map<keyof PenguinRow, d3.ScaleLinear<number, number>>();
    const y = new Map<keyof PenguinRow, d3.ScaleLinear<number, number>>();

    variables.forEach((v) => {
      const extent = d3.extent(data, (d) => (d[v] as number) ?? NaN) as [
        number,
        number,
      ];
      const xScale = d3
        .scaleLinear()
        .domain(extent)
        .range([0, size - 40])
        .nice();
      const yScale = d3
        .scaleLinear()
        .domain(extent)
        .range([size - 40, 0])
        .nice();
      x.set(v, xScale);
      y.set(v, yScale);
    });

    // color by species
    const species = Array.from(new Set(data.map((d) => d.species)));
    const color = d3
      .scaleOrdinal<string, string>()
      .domain(species)
      .range(d3.schemeCategory10.slice(0, species.length));

    // cell container
    const g = root
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // axes along the top row and left column
    for (let i = 0; i < n; ++i) {
      // top axes (row 0)
      g.append('g')
        .attr('transform', `translate(${i * size + 30}, 10)`) // slight padding
        .call(d3.axisTop(x.get(variables[i])! as d3.AxisScale<number>).ticks(4))
        .call((s) => {
          s.selectAll('text').attr('font-size', 14).attr('fill', '#000');
          s.selectAll('path').attr('stroke', '#000');
          s.selectAll('line').attr('stroke', '#000');
          s.selectAll('text').attr('filter', 'url(#splomTextShadow)');
        });

      // left axes (col 0)
      g.append('g')
        .attr('transform', `translate(10, ${i * size + 30})`)
        .call(
          d3.axisLeft(y.get(variables[i])! as d3.AxisScale<number>).ticks(4)
        )
        .call((s) => {
          s.selectAll('text').attr('font-size', 14).attr('fill', '#000');
          s.selectAll('path').attr('stroke', '#000');
          s.selectAll('line').attr('stroke', '#000');
          s.selectAll('text').attr('filter', 'url(#splomTextShadow)');
        });
    }

    // legend to the right for species
    // positioned just to the right of the grid so it doesn't overlap axes on the top/left
    const legendX = n * size + 5;
    const legendY = 20;
    const legend = g
      .append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${legendX}, ${legendY})`);

    const legendItems = legend
      .selectAll('g.legend-item')
      .data(species)
      .enter()
      .append('g')
      .attr('class', 'legend-item')
      .attr('transform', (_d, i) => `translate(0, ${20 + i * 24})`);

    legendItems
      .append('circle')
      .attr('r', 6)
      .attr('cx', 6)
      .attr('cy', 6)
      .attr('fill', (d) => color(d));

    legendItems
      .append('text')
      .attr('x', 20)
      .attr('y', 6)
      .attr('font-size', 14)
      .attr('fill', '#000')
      .attr('dominant-baseline', 'middle')
      .attr('filter', 'url(#splomTextShadow)')
      .text((d) => d);

    // cell background and titles on diagonal
    for (let i = 0; i < n; ++i) {
      for (let j = 0; j < n; ++j) {
        const cell = g
          .append('g')
          .attr('class', 'cell')
          .attr('data-key', `${i}-${j}`)
          .attr('transform', `translate(${i * size + 30}, ${j * size + 30})`);

        // background rect
        cell
          .append('rect')
          .attr('width', size - 40)
          .attr('height', size - 40)
          .attr('fill', 'rgba(0,0,0,0.06)')
          .attr('stroke', 'rgba(0,0,0,0.25)')
          .attr('rx', 6)
          .attr('ry', 6);

        // title on diagonal
        if (i === j) {
          cell
            .append('text')
            .attr('x', 6)
            .attr('y', 16)
            .attr('font-size', 16)
            .attr('fill', '#000')
            .attr('filter', 'url(#splomTextShadow)')
            .text(String(variables[i]));
        }
      }
    }

    // draw points for each cell
    for (let i = 0; i < n; ++i) {
      for (let j = 0; j < n; ++j) {
        const cell = g.select(`g.cell[data-key="${i}-${j}"]`);
        const vx = variables[i];
        const vy = variables[j];
        const xScale = x.get(vx)!;
        const yScale = y.get(vy)!;

        cell
          .append('g')
          .attr('class', 'points')
          .selectAll('circle')
          .data<PenguinRow>(data)
          .enter()
          .append('circle')
          .attr('cx', (d: PenguinRow) => xScale(d[vx] as number))
          .attr('cy', (d: PenguinRow) => yScale(d[vy] as number))
          .attr('r', 4)
          .attr('fill', (d: PenguinRow) => color(d.species))
          .attr('fill-opacity', 0.85)
          .attr('stroke', 'rgba(0,0,0,0.4)')
          .attr('stroke-width', 0.3)
          .attr('class', 'splom-point interactable')
          .attr('data-rowid', (d: PenguinRow) => d.rowid);
      }
    }

    // apply initial hover highlights from per-client map
    const applyHighlightFromShared = () => {
      const hoveredIds: string[] = [];
      yClientHoverRows.forEach((ids: string[]) => {
        if (Array.isArray(ids)) hoveredIds.push(...ids);
      });
      const current = new Set<string>(hoveredIds);
      const prev = prevHoveredRowsRef.current;

      root.classed('splom-highlight-active', current.size > 0);

      current.forEach((rid) => {
        if (!prev.has(rid)) {
          root
            .selectAll(`circle.splom-point[data-rowid='${rid}']`)
            .classed('highlighted', true);
        }
      });

      prev.forEach((rid) => {
        if (!current.has(rid)) {
          root
            .selectAll(`circle.splom-point[data-rowid='${rid}']`)
            .classed('highlighted', false);
        }
      });

      prevHoveredRowsRef.current = current;
    };

    // interaction handler for gestures from overlay
    const handleInteraction = (interaction: InteractionEvent) => {
      if (interaction.type === 'drag' || interaction.type === 'zoom') {
        const t = interaction.transform as
          | { x: number; y: number }
          | { x: number; y: number; scale: number };
        const x = t.x;
        const y = t.y;
        const scale =
          interaction.type === 'zoom'
            ? (t as { x: number; y: number; scale: number }).scale
            : currentTransform.k;
        doc!.transact(() => {
          ySharedState.set('panX', x);
          ySharedState.set('panY', y);
          ySharedState.set('zoomScale', scale);
        });
        setCurrentTransform(d3.zoomIdentity.translate(x, y).scale(scale));
        root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
        return;
      }
      if (interaction.type === 'pointerover') {
        const el = interaction.element as
          | (SVGCircleElement & { dataset: DOMStringMap })
          | undefined;
        if (el && el.classList.contains('splom-point')) {
          const rowid = el.dataset.rowid;
          if (rowid) {
            const current = yClientHoverRows.get(userId) || [];
            if (!current.includes(rowid)) {
              doc!.transact(() => {
                yClientHoverRows.set(userId, [...current, rowid]);
              });
            }
          }
        }
        return;
      }
      if (interaction.type === 'pointerout') {
        const el = interaction.element as
          | (SVGCircleElement & { dataset: DOMStringMap })
          | undefined;
        if (el && el.classList.contains('splom-point')) {
          const rowid = el.dataset.rowid;
          if (rowid) {
            const current = yClientHoverRows.get(userId) || [];
            const next = current.filter((id) => id !== rowid);
            doc!.transact(() => {
              yClientHoverRows.set(userId, next);
            });
          }
        }
        return;
      }
    };

    const parent = d3Container.current?.parentElement;
    const interactionListener = ((e: Event) => {
      const ce = e as CustomEvent<InteractionEvent>;
      handleInteraction(ce.detail);
    }) as EventListener;
    if (parent) {
      parent.addEventListener('interaction', interactionListener);
    }

    // initialize shared transform defaults centered on content if undefined
    if (ySharedState.get('zoomScale') === undefined) {
      const bbox = (root.node() as SVGGElement | null)?.getBBox?.();
      let cx = 0;
      let cy = 0;
      if (bbox) {
        // center by aligning content bbox center to svg center
        cx = fixedWidth / 2 - (bbox.x + bbox.width / 2);
        cy = fixedHeight / 2 - (bbox.y + bbox.height / 2);
      }
      doc!.transact(() => {
        ySharedState.set('zoomScale', 1);
        ySharedState.set('panX', cx);
        ySharedState.set('panY', cy);
      });
      // update local transform immediately to avoid a flash at (0,0)
      transformRef.current = { k: 1, x: cx, y: cy };
      setCurrentTransform(d3.zoomIdentity.translate(cx, cy).scale(1));
      root.attr('transform', `translate(${cx}, ${cy}) scale(1)`);
    }

    // reflect any existing shared hover state immediately
    applyHighlightFromShared();

    return () => {
      if (parent) {
        parent.removeEventListener('interaction', interactionListener);
      }
      // clear any lingering highlight state
      root.classed('splom-highlight-active', false);
      root
        .selectAll('circle.splom-point.highlighted')
        .classed('highlighted', false);
      // clear this client's hover state entry to avoid stale highlights
      try {
        const current = yClientHoverRows.get(userId) || [];
        if (current.length > 0) {
          doc!.transact(() => {
            yClientHoverRows.set(userId, []);
          });
        }
      } catch {}
    };
  }, [
    syncStatus,
    data,
    doc,
    ySharedState,
    currentTransform.k,
    yClientHoverRows,
    userId,
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
            penguin splom
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

export default Splom;
