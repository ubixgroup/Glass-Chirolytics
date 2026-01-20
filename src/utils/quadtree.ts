import { Point } from '@/types/types';

// quadtree implementation for spatial indexing of dom elements
export interface QuadTreeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QuadTreeElement {
  element: Element;
  bounds: QuadTreeBounds;
}

export class QuadTree {
  private bounds: QuadTreeBounds;
  private maxElements: number;
  private maxDepth: number;
  private depth: number;
  private elements: QuadTreeElement[];
  private nodes: QuadTree[];
  private isLeaf: boolean;

  constructor(
    bounds: QuadTreeBounds,
    maxElements = 10,
    maxDepth = 5,
    depth = 0
  ) {
    this.bounds = bounds;
    this.maxElements = maxElements;
    this.maxDepth = maxDepth;
    this.depth = depth;
    this.elements = [];
    this.nodes = [];
    this.isLeaf = true;
  }

  // insert an element into the quadtree
  insert(element: QuadTreeElement): void {
    if (!this.intersects(element.bounds)) {
      return;
    }

    if (this.isLeaf) {
      this.elements.push(element);

      // subdivide if we exceed capacity and haven't reached max depth
      if (
        this.elements.length > this.maxElements &&
        this.depth < this.maxDepth
      ) {
        this.subdivide();
      }
    } else {
      // insert into child nodes
      for (const node of this.nodes) {
        node.insert(element);
      }
    }
  }

  // subdivide the current node into four quadrants
  private subdivide(): void {
    const halfWidth = this.bounds.width / 2;
    const halfHeight = this.bounds.height / 2;
    const x = this.bounds.x;
    const y = this.bounds.y;

    // create four child nodes
    this.nodes = [
      // top-left
      new QuadTree(
        { x, y, width: halfWidth, height: halfHeight },
        this.maxElements,
        this.maxDepth,
        this.depth + 1
      ),
      // top-right
      new QuadTree(
        { x: x + halfWidth, y, width: halfWidth, height: halfHeight },
        this.maxElements,
        this.maxDepth,
        this.depth + 1
      ),
      // bottom-left
      new QuadTree(
        { x, y: y + halfHeight, width: halfWidth, height: halfHeight },
        this.maxElements,
        this.maxDepth,
        this.depth + 1
      ),
      // bottom-right
      new QuadTree(
        {
          x: x + halfWidth,
          y: y + halfHeight,
          width: halfWidth,
          height: halfHeight,
        },
        this.maxElements,
        this.maxDepth,
        this.depth + 1
      ),
    ];

    // redistribute existing elements to child nodes
    for (const element of this.elements) {
      for (const node of this.nodes) {
        node.insert(element);
      }
    }

    // this node is no longer a leaf
    this.isLeaf = false;
    this.elements = []; // clear elements from internal node
  }

  // query elements that intersect with a circle
  queryCircle(center: Point, radius: number): Element[] {
    const result: Element[] = [];
    this.queryCircleRecursive(center, radius, result);
    return result;
  }

  private queryCircleRecursive(
    center: Point,
    radius: number,
    result: Element[]
  ): void {
    // check if circle intersects with this node's bounds
    if (!this.circleIntersectsBounds(center, radius, this.bounds)) {
      return;
    }

    if (this.isLeaf) {
      // check each element in this leaf node
      for (const qtElement of this.elements) {
        if (this.circleIntersectsRect(center, radius, qtElement.bounds)) {
          result.push(qtElement.element);
        }
      }
    } else {
      // recurse into child nodes
      for (const node of this.nodes) {
        node.queryCircleRecursive(center, radius, result);
      }
    }
  }

  // check if a bounds intersects with this node's bounds
  private intersects(bounds: QuadTreeBounds): boolean {
    return !(
      bounds.x > this.bounds.x + this.bounds.width ||
      bounds.x + bounds.width < this.bounds.x ||
      bounds.y > this.bounds.y + this.bounds.height ||
      bounds.y + bounds.height < this.bounds.y
    );
  }

  // check if circle intersects with bounds
  private circleIntersectsBounds(
    center: Point,
    radius: number,
    bounds: QuadTreeBounds
  ): boolean {
    // find the closest point on the rectangle to the circle center
    const closestX = Math.max(
      bounds.x,
      Math.min(center.x, bounds.x + bounds.width)
    );
    const closestY = Math.max(
      bounds.y,
      Math.min(center.y, bounds.y + bounds.height)
    );

    // calculate distance from circle center to closest point
    const dx = center.x - closestX;
    const dy = center.y - closestY;
    const distanceSquared = dx * dx + dy * dy;

    return distanceSquared <= radius * radius;
  }

  // check if circle intersects with rectangle
  private circleIntersectsRect(
    center: Point,
    radius: number,
    rect: QuadTreeBounds
  ): boolean {
    return this.circleIntersectsBounds(center, radius, rect);
  }

  // clear all elements from the quadtree
  clear(): void {
    this.elements = [];
    this.nodes = [];
    this.isLeaf = true;
  }
}
