/* 
 fdeb algorithm implementation [www.win.tue.nl/~dholten/papers/forcebundles_eurovis.pdf].

 author: corneliu s. (github.com/upphiminn)
 2013

 */

// type definitions for the force edge bundling algorithm
interface Point {
  x: number;
  y: number;
}

interface Node extends Point {
  id?: string;
}

interface Edge {
  source: string;
  target: string;
}

interface DataNodes {
  [nodeId: string]: Node;
}

interface ForceEdgeBundling {
  (): Point[][];
  nodes(nl?: DataNodes): ForceEdgeBundling | DataNodes;
  edges(ll?: Edge[]): ForceEdgeBundling | Edge[];
  bundling_stiffness(k?: number): ForceEdgeBundling | number;
  step_size(step?: number): ForceEdgeBundling | number;
  cycles(c?: number): ForceEdgeBundling | number;
  iterations(i?: number): ForceEdgeBundling | number;
  iterations_rate(i?: number): ForceEdgeBundling | number;
  subdivision_points_seed(p?: number): ForceEdgeBundling | number;
  subdivision_rate(r?: number): ForceEdgeBundling | number;
  compatibility_threshold(t?: number): ForceEdgeBundling | number;
}

// extend the global d3 interface
declare global {
  interface Window {
    d3?: {
      ForceEdgeBundling?: () => ForceEdgeBundling;
    };
  }
}

// create d3 namespace safely
const getD3Namespace = (): { ForceEdgeBundling?: () => ForceEdgeBundling } => {
  if (typeof window !== 'undefined') {
    (
      window as Window & {
        d3?: { ForceEdgeBundling?: () => ForceEdgeBundling };
      }
    ).d3 =
      (
        window as Window & {
          d3?: { ForceEdgeBundling?: () => ForceEdgeBundling };
        }
      ).d3 || {};
    return (
      window as Window & {
        d3?: { ForceEdgeBundling?: () => ForceEdgeBundling };
      }
    ).d3!;
  }
  return {};
};

(function (): void {
  const d3Namespace = getD3Namespace();

  d3Namespace.ForceEdgeBundling = function (): ForceEdgeBundling {
    let data_nodes: DataNodes = {}; // {'nodeid':{'x':,'y':},..}
    let data_edges: Edge[] = []; // [{'source':'nodeid1', 'target':'nodeid2'},..]
    const compatibility_list_for_edge: number[][] = [];
    const subdivision_points_for_edge: Point[][] = [];
    let K: number = 0.1; // global bundling constant controlling edge stiffness
    let S_initial: number = 0.1; // init. distance to move points
    let P_initial: number = 1; // init. subdivision number
    let P_rate: number = 2; // subdivision rate increase
    let C: number = 6; // number of cycles to perform
    let I_initial: number = 90; // init. number of iterations for cycle
    let I_rate: number = 0.6666667; // rate at which iteration number decreases i.e. 2/3
    let compatibility_threshold: number = 0.6;
    const eps: number = 1e-6;

    /*** geometry helper methods ***/
    function vector_dot_product(p: Point, q: Point): number {
      return p.x * q.x + p.y * q.y;
    }

    function edge_as_vector(P: Edge): Point {
      return {
        x: data_nodes[P.target].x - data_nodes[P.source].x,
        y: data_nodes[P.target].y - data_nodes[P.source].y,
      };
    }

    function edge_length(e: Edge): number {
      // handling nodes that are on the same location, so that K/edge_length != Inf
      if (
        Math.abs(data_nodes[e.source].x - data_nodes[e.target].x) < eps &&
        Math.abs(data_nodes[e.source].y - data_nodes[e.target].y) < eps
      ) {
        return eps;
      }

      return Math.sqrt(
        Math.pow(data_nodes[e.source].x - data_nodes[e.target].x, 2) +
          Math.pow(data_nodes[e.source].y - data_nodes[e.target].y, 2)
      );
    }

    function custom_edge_length(e: { source: Point; target: Point }): number {
      return Math.sqrt(
        Math.pow(e.source.x - e.target.x, 2) +
          Math.pow(e.source.y - e.target.y, 2)
      );
    }

    function edge_midpoint(e: Edge): Point {
      const middle_x: number =
        (data_nodes[e.source].x + data_nodes[e.target].x) / 2.0;
      const middle_y: number =
        (data_nodes[e.source].y + data_nodes[e.target].y) / 2.0;

      return {
        x: middle_x,
        y: middle_y,
      };
    }

    function compute_divided_edge_length(e_idx: number): number {
      let length: number = 0;

      for (
        let i: number = 1;
        i < subdivision_points_for_edge[e_idx].length;
        i++
      ) {
        const segment_length: number = euclidean_distance(
          subdivision_points_for_edge[e_idx][i],
          subdivision_points_for_edge[e_idx][i - 1]
        );
        length += segment_length;
      }

      return length;
    }

    function euclidean_distance(p: Point, q: Point): number {
      return Math.sqrt(Math.pow(p.x - q.x, 2) + Math.pow(p.y - q.y, 2));
    }

    function project_point_on_line(
      p: Point,
      Q: { source: Point; target: Point }
    ): Point {
      const L: number = Math.sqrt(
        (Q.target.x - Q.source.x) * (Q.target.x - Q.source.x) +
          (Q.target.y - Q.source.y) * (Q.target.y - Q.source.y)
      );
      const r: number =
        ((Q.source.y - p.y) * (Q.source.y - Q.target.y) -
          (Q.source.x - p.x) * (Q.target.x - Q.source.x)) /
        (L * L);

      return {
        x: Q.source.x + r * (Q.target.x - Q.source.x),
        y: Q.source.y + r * (Q.target.y - Q.source.y),
      };
    }

    /*** ********************** ***/

    /*** initialization methods ***/
    function initialize_edge_subdivisions(): void {
      for (let i: number = 0; i < data_edges.length; i++) {
        if (P_initial === 1) {
          subdivision_points_for_edge[i] = []; //0 subdivisions
        } else {
          subdivision_points_for_edge[i] = [];
          subdivision_points_for_edge[i].push(data_nodes[data_edges[i].source]);
          subdivision_points_for_edge[i].push(data_nodes[data_edges[i].target]);
        }
      }
    }

    function initialize_compatibility_lists(): void {
      for (let i: number = 0; i < data_edges.length; i++) {
        compatibility_list_for_edge[i] = []; //0 compatible edges.
      }
    }

    function filter_self_loops(edgelist: Edge[]): Edge[] {
      const filtered_edge_list: Edge[] = [];

      for (let e: number = 0; e < edgelist.length; e++) {
        if (
          data_nodes[edgelist[e].source].x !=
            data_nodes[edgelist[e].target].x ||
          data_nodes[edgelist[e].source].y != data_nodes[edgelist[e].target].y
        ) {
          //or smaller than eps
          filtered_edge_list.push(edgelist[e]);
        }
      }

      return filtered_edge_list;
    }

    /*** ********************** ***/

    /*** force calculation methods ***/
    function apply_spring_force(e_idx: number, i: number, kP: number): Point {
      const prev: Point = subdivision_points_for_edge[e_idx][i - 1];
      const next: Point = subdivision_points_for_edge[e_idx][i + 1];
      const crnt: Point = subdivision_points_for_edge[e_idx][i];
      let x: number = prev.x - crnt.x + next.x - crnt.x;
      let y: number = prev.y - crnt.y + next.y - crnt.y;

      x *= kP;
      y *= kP;

      return {
        x: x,
        y: y,
      };
    }

    function apply_electrostatic_force(e_idx: number, i: number): Point {
      const sum_of_forces: Point = {
        x: 0,
        y: 0,
      };
      const compatible_edges_list: number[] =
        compatibility_list_for_edge[e_idx];

      for (let oe: number = 0; oe < compatible_edges_list.length; oe++) {
        const force: Point = {
          x:
            subdivision_points_for_edge[compatible_edges_list[oe]][i].x -
            subdivision_points_for_edge[e_idx][i].x,
          y:
            subdivision_points_for_edge[compatible_edges_list[oe]][i].y -
            subdivision_points_for_edge[e_idx][i].y,
        };

        if (Math.abs(force.x) > eps || Math.abs(force.y) > eps) {
          const diff: number =
            1 /
            Math.pow(
              custom_edge_length({
                source:
                  subdivision_points_for_edge[compatible_edges_list[oe]][i],
                target: subdivision_points_for_edge[e_idx][i],
              }),
              1
            );

          sum_of_forces.x += force.x * diff;
          sum_of_forces.y += force.y * diff;
        }
      }

      return sum_of_forces;
    }

    function apply_resulting_forces_on_subdivision_points(
      e_idx: number,
      P: number,
      S: number
    ): Point[] {
      const kP: number = K / (edge_length(data_edges[e_idx]) * (P + 1)); // kP=K/|P|(number of segments), where |P| is the initial length of edge P.
      // (length * (num of sub division pts - 1))
      const resulting_forces_for_subdivision_points: Point[] = [
        {
          x: 0,
          y: 0,
        },
      ];

      for (let i: number = 1; i < P + 1; i++) {
        // exclude initial end points of the edge 0 and P+1
        const resulting_force: Point = {
          x: 0,
          y: 0,
        };

        const spring_force: Point = apply_spring_force(e_idx, i, kP);
        const electrostatic_force: Point = apply_electrostatic_force(e_idx, i);

        resulting_force.x = S * (spring_force.x + electrostatic_force.x);
        resulting_force.y = S * (spring_force.y + electrostatic_force.y);

        resulting_forces_for_subdivision_points.push(resulting_force);
      }

      resulting_forces_for_subdivision_points.push({
        x: 0,
        y: 0,
      });

      return resulting_forces_for_subdivision_points;
    }

    /*** ********************** ***/

    /*** edge division calculation methods ***/
    function update_edge_divisions(P: number): void {
      for (let e_idx: number = 0; e_idx < data_edges.length; e_idx++) {
        if (P === 1) {
          subdivision_points_for_edge[e_idx].push(
            data_nodes[data_edges[e_idx].source]
          ); // source
          subdivision_points_for_edge[e_idx].push(
            edge_midpoint(data_edges[e_idx])
          ); // mid point
          subdivision_points_for_edge[e_idx].push(
            data_nodes[data_edges[e_idx].target]
          ); // target
        } else {
          const divided_edge_length: number =
            compute_divided_edge_length(e_idx);
          const segment_length: number = divided_edge_length / (P + 1);
          let current_segment_length: number = segment_length;
          const new_subdivision_points: Point[] = [];
          new_subdivision_points.push(data_nodes[data_edges[e_idx].source]); //source

          for (
            let i: number = 1;
            i < subdivision_points_for_edge[e_idx].length;
            i++
          ) {
            let old_segment_length: number = euclidean_distance(
              subdivision_points_for_edge[e_idx][i],
              subdivision_points_for_edge[e_idx][i - 1]
            );

            while (old_segment_length > current_segment_length) {
              const percent_position: number =
                current_segment_length / old_segment_length;
              let new_subdivision_point_x: number =
                subdivision_points_for_edge[e_idx][i - 1].x;
              let new_subdivision_point_y: number =
                subdivision_points_for_edge[e_idx][i - 1].y;

              new_subdivision_point_x +=
                percent_position *
                (subdivision_points_for_edge[e_idx][i].x -
                  subdivision_points_for_edge[e_idx][i - 1].x);
              new_subdivision_point_y +=
                percent_position *
                (subdivision_points_for_edge[e_idx][i].y -
                  subdivision_points_for_edge[e_idx][i - 1].y);
              new_subdivision_points.push({
                x: new_subdivision_point_x,
                y: new_subdivision_point_y,
              });

              old_segment_length -= current_segment_length;
              current_segment_length = segment_length;
            }
            current_segment_length -= old_segment_length;
          }
          new_subdivision_points.push(data_nodes[data_edges[e_idx].target]); //target
          subdivision_points_for_edge[e_idx] = new_subdivision_points;
        }
      }
    }

    /*** ********************** ***/

    /*** edge compatibility measures ***/
    function angle_compatibility(P: Edge, Q: Edge): number {
      return Math.abs(
        vector_dot_product(edge_as_vector(P), edge_as_vector(Q)) /
          (edge_length(P) * edge_length(Q))
      );
    }

    function scale_compatibility(P: Edge, Q: Edge): number {
      const lavg: number = (edge_length(P) + edge_length(Q)) / 2.0;
      return (
        2.0 /
        (lavg / Math.min(edge_length(P), edge_length(Q)) +
          Math.max(edge_length(P), edge_length(Q)) / lavg)
      );
    }

    function position_compatibility(P: Edge, Q: Edge): number {
      const lavg: number = (edge_length(P) + edge_length(Q)) / 2.0;
      const midP: Point = {
        x: (data_nodes[P.source].x + data_nodes[P.target].x) / 2.0,
        y: (data_nodes[P.source].y + data_nodes[P.target].y) / 2.0,
      };
      const midQ: Point = {
        x: (data_nodes[Q.source].x + data_nodes[Q.target].x) / 2.0,
        y: (data_nodes[Q.source].y + data_nodes[Q.target].y) / 2.0,
      };

      return lavg / (lavg + euclidean_distance(midP, midQ));
    }

    function edge_visibility(P: Edge, Q: Edge): number {
      const I0: Point = project_point_on_line(data_nodes[Q.source], {
        source: data_nodes[P.source],
        target: data_nodes[P.target],
      });
      const I1: Point = project_point_on_line(data_nodes[Q.target], {
        source: data_nodes[P.source],
        target: data_nodes[P.target],
      }); //send actual edge points positions
      const midI: Point = {
        x: (I0.x + I1.x) / 2.0,
        y: (I0.y + I1.y) / 2.0,
      };
      const midP: Point = {
        x: (data_nodes[P.source].x + data_nodes[P.target].x) / 2.0,
        y: (data_nodes[P.source].y + data_nodes[P.target].y) / 2.0,
      };

      return Math.max(
        0,
        1 - (2 * euclidean_distance(midP, midI)) / euclidean_distance(I0, I1)
      );
    }

    function visibility_compatibility(P: Edge, Q: Edge): number {
      return Math.min(edge_visibility(P, Q), edge_visibility(Q, P));
    }

    function compatibility_score(P: Edge, Q: Edge): number {
      return (
        angle_compatibility(P, Q) *
        scale_compatibility(P, Q) *
        position_compatibility(P, Q) *
        visibility_compatibility(P, Q)
      );
    }

    function are_compatible(P: Edge, Q: Edge): boolean {
      return compatibility_score(P, Q) >= compatibility_threshold;
    }

    function compute_compatibility_lists(): void {
      for (let e: number = 0; e < data_edges.length - 1; e++) {
        for (let oe: number = e + 1; oe < data_edges.length; oe++) {
          // don't want any duplicates
          if (are_compatible(data_edges[e], data_edges[oe])) {
            compatibility_list_for_edge[e].push(oe);
            compatibility_list_for_edge[oe].push(e);
          }
        }
      }
    }

    /*** ************************ ***/

    /*** main bundling loop methods ***/
    const forcebundle = function (): Point[][] {
      let S: number = S_initial;
      let I: number = I_initial;
      let P: number = P_initial;

      initialize_edge_subdivisions();
      initialize_compatibility_lists();
      update_edge_divisions(P);
      compute_compatibility_lists();

      for (let cycle: number = 0; cycle < C; cycle++) {
        for (let iteration: number = 0; iteration < I; iteration++) {
          const forces: Point[][] = [];
          for (let edge: number = 0; edge < data_edges.length; edge++) {
            forces[edge] = apply_resulting_forces_on_subdivision_points(
              edge,
              P,
              S
            );
          }
          for (let e: number = 0; e < data_edges.length; e++) {
            for (let i: number = 0; i < P + 1; i++) {
              subdivision_points_for_edge[e][i].x += forces[e][i].x;
              subdivision_points_for_edge[e][i].y += forces[e][i].y;
            }
          }
        }
        // prepare for next cycle
        S = S / 2;
        P = P * P_rate;
        I = I_rate * I;

        update_edge_divisions(P);
        //console.log('C' + cycle);
        //console.log('P' + P);
        //console.log('S' + S);
      }
      return subdivision_points_for_edge;
    };
    /*** ************************ ***/

    /*** getters/setters methods ***/
    (forcebundle as ForceEdgeBundling).nodes = function (
      nl?: DataNodes
    ): ForceEdgeBundling | DataNodes {
      if (arguments.length === 0) {
        return data_nodes;
      } else {
        data_nodes = nl!;
      }

      return forcebundle as ForceEdgeBundling;
    };

    (forcebundle as ForceEdgeBundling).edges = function (
      ll?: Edge[]
    ): ForceEdgeBundling | Edge[] {
      if (arguments.length === 0) {
        return data_edges;
      } else {
        data_edges = filter_self_loops(ll!); //remove edges to from to the same point
      }

      return forcebundle as ForceEdgeBundling;
    };

    (forcebundle as ForceEdgeBundling).bundling_stiffness = function (
      k?: number
    ): ForceEdgeBundling | number {
      if (arguments.length === 0) {
        return K;
      } else {
        K = k!;
      }

      return forcebundle as ForceEdgeBundling;
    };

    (forcebundle as ForceEdgeBundling).step_size = function (
      step?: number
    ): ForceEdgeBundling | number {
      if (arguments.length === 0) {
        return S_initial;
      } else {
        S_initial = step!;
      }

      return forcebundle as ForceEdgeBundling;
    };

    (forcebundle as ForceEdgeBundling).cycles = function (
      c?: number
    ): ForceEdgeBundling | number {
      if (arguments.length === 0) {
        return C;
      } else {
        C = c!;
      }

      return forcebundle as ForceEdgeBundling;
    };

    (forcebundle as ForceEdgeBundling).iterations = function (
      i?: number
    ): ForceEdgeBundling | number {
      if (arguments.length === 0) {
        return I_initial;
      } else {
        I_initial = i!;
      }

      return forcebundle as ForceEdgeBundling;
    };

    (forcebundle as ForceEdgeBundling).iterations_rate = function (
      i?: number
    ): ForceEdgeBundling | number {
      if (arguments.length === 0) {
        return I_rate;
      } else {
        I_rate = i!;
      }

      return forcebundle as ForceEdgeBundling;
    };

    (forcebundle as ForceEdgeBundling).subdivision_points_seed = function (
      p?: number
    ): ForceEdgeBundling | number {
      if (arguments.length === 0) {
        return P_initial;
      } else {
        P_initial = p!;
      }

      return forcebundle as ForceEdgeBundling;
    };

    (forcebundle as ForceEdgeBundling).subdivision_rate = function (
      r?: number
    ): ForceEdgeBundling | number {
      if (arguments.length === 0) {
        return P_rate;
      } else {
        P_rate = r!;
      }

      return forcebundle as ForceEdgeBundling;
    };

    (forcebundle as ForceEdgeBundling).compatibility_threshold = function (
      t?: number
    ): ForceEdgeBundling | number {
      if (arguments.length === 0) {
        return compatibility_threshold;
      } else {
        compatibility_threshold = t!;
      }

      return forcebundle as ForceEdgeBundling;
    };

    /*** ************************ ***/

    return forcebundle as ForceEdgeBundling;
  };
})();

// export for module compatibility - get the function from d3 namespace
const d3NamespaceForExport = getD3Namespace();
export const ForceEdgeBundling = d3NamespaceForExport.ForceEdgeBundling;
export type { Point, Node, Edge, DataNodes };
