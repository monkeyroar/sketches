import hull from "hull.js";
import { asyncScheduler, map, Observable, observeOn, range } from "rxjs";
import { random } from "../util/random";
import { sync_timer } from "../util/timing";
import { CompoundPath, Matrix, Path, Point, Rectangle } from "./paper";

export type HorVerBounds = {
  minHor: number;
  minVer: number;
  maxHor: number;
  maxVer: number;
};

export type RandomizationParams = {
  rotationBounds?: [number, number];
  skewBounds?: HorVerBounds;
  shearBounds?: HorVerBounds;
};

export type PackingParams = {
  boundingRect: Rectangle;
  nShapes: number;
  blacklistShape?: CompoundPath;
  //whitelistShape?: CompoundPath; - need to implement
  randomizeParams?: RandomizationParams;
};

// Using class here to add execution time decorators
class Packing {
  private static zeta(z: number): number {
    const secondTerm = (z + 3) / (z - 1);
    const thirdTerm = 1 / Math.pow(2, z + 1);
    return 1 + secondTerm * thirdTerm;
  }

  private static concaveHull(shape: Point[] | CompoundPath, concavity = 50): CompoundPath {
    const pointSet = (shape instanceof CompoundPath ? shape.toPoints() : shape).map((point) => [point.x, point.y]);
    const hullShape = hull(pointSet, concavity) as number[][];
    const hullPath = new Path(hullShape.map((point) => new Point(point[0], point[1])));
    return new CompoundPath(hullPath);
  }

  private static tryTransformMatrix(
    tryPath: CompoundPath,
    boundingRect: Rectangle,
    randomizeParams?: RandomizationParams
  ): Matrix {
    const matrix = new Matrix();
    const [minX, minY, maxX, maxY] = [boundingRect.left, boundingRect.bottom, boundingRect.right, boundingRect.top];
    const [x, y] = [random(minX - tryPath.bounds.width, maxX), random(minY - tryPath.bounds.height, maxY)];

    matrix.translate([x, y]);
    if (randomizeParams) {
      if (randomizeParams.rotationBounds) {
        const rotation = random(randomizeParams.rotationBounds[0], randomizeParams.rotationBounds[1]);
        matrix.rotate(rotation, tryPath.position);
      }
      if (randomizeParams.skewBounds) {
        const skewHor = random(randomizeParams.skewBounds.minHor, randomizeParams.skewBounds.maxHor);
        const skewVer = random(randomizeParams.skewBounds.minVer, randomizeParams.skewBounds.maxVer);
        matrix.skew(skewHor, skewVer);
      }
      if (randomizeParams.shearBounds) {
        const shearHor = random(randomizeParams.shearBounds.minHor, randomizeParams.shearBounds.maxHor);
        const shearVer = random(randomizeParams.shearBounds.minVer, randomizeParams.shearBounds.maxVer);
        matrix.shear(shearHor, shearVer);
      }
    }
    return matrix;
  }

  private static intersectsExistingPaths(tryPath: CompoundPath, pathsToCheck: CompoundPath[]): boolean {
    const tryPathPoints = tryPath.childPaths.flatMap((path) => [path.getPointAt(0), path.getPointAt(path.length / 2)]);
    const intersects = pathsToCheck.some(
      (path) => tryPathPoints.some((point) => path.contains(point)) || tryPath.intersects(path)
    );
    return intersects;
  }

  private static tryPlaceTile(
    tryPath: CompoundPath,
    existingPaths: CompoundPath[],
    boundingRect: Rectangle,
    blacklistShape?: CompoundPath,
    randomizeParams?: RandomizationParams,
    nTries = 100
  ): CompoundPath {
    const pathsToCheck = blacklistShape ? [blacklistShape, ...existingPaths] : existingPaths;
    while (true) {
      for (let i = 0; i < nTries; i++) {
        const matrix = Packing.tryTransformMatrix(tryPath, boundingRect, randomizeParams);
        tryPath.transform(matrix);
        if (!Packing.intersectsExistingPaths(tryPath, pathsToCheck)) return tryPath;
        tryPath.transform(matrix.invert());
      }
      console.log("scaling down");
      tryPath.scale(0.9, [0, 0]);
    }
  }

  // http://paulbourke.net/fractals/randomtile/
  @sync_timer //TODO: not working
  static generatePacking(
    shapesFactory: (i: number) => CompoundPath,
    { boundingRect, nShapes, blacklistShape, randomizeParams }: PackingParams
  ): Observable<CompoundPath> {
    //TODO: Improve performance
    const paths: CompoundPath[] = [];
    const c = random(1.1, 1.2); //TODO: try [1, 1.5]
    const rectArea = Math.abs(boundingRect.width * boundingRect.height);
    const totalArea = rectArea - (blacklistShape?.area || 0);
    const initialArea = totalArea / Packing.zeta(c);

    return range(0, nShapes)
      .pipe(observeOn(asyncScheduler))
      .pipe(
        map((i) => {
          (i + 1) % 100 == 0 && console.log(`Packed ${i + 1} shapes out of ${nShapes}`);
          const desiredArea = i == 0 ? initialArea : initialArea * Math.pow(i, -c);
          const tryPath = shapesFactory(i).reorient(false, true) as CompoundPath;
          const tryArea = Packing.concaveHull(tryPath).area; //TODO: Test with convex polygons, try to get rid of `concaveHull()`
          const scaleFactor = Math.sqrt(desiredArea / tryArea);
          tryPath.scale(scaleFactor, [0, 0]);
          const newPath = Packing.tryPlaceTile(tryPath, paths, boundingRect, blacklistShape, randomizeParams);
          paths.push(newPath);
          return newPath;
        })
      );
  }
}

export function generatePacking(
  shapesFactory: (i: number) => CompoundPath,
  packingParams: PackingParams
): Observable<CompoundPath> {
  return Packing.generatePacking(shapesFactory, packingParams);
}
