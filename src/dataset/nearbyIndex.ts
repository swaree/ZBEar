import { distanceM } from "../domain/geo";
import type { LatLng } from "../domain/types";

const METRES_PER_DEGREE_LAT = 111_320;

/** Points bucketed in a grid, to find those within a fixed radius of a place without scanning them all. */
export class NearbyIndex<T extends { location: LatLng }> {
  private readonly cellDeg: number;
  private readonly cells = new Map<string, T[]>();

  constructor(
    items: Iterable<T>,
    private readonly radiusM: number,
  ) {
    this.cellDeg = radiusM / METRES_PER_DEGREE_LAT;
    for (const item of items) {
      const key = this.key(this.row(item.location.lat), this.col(item.location.lng));
      const cell = this.cells.get(key);
      if (cell) cell.push(item);
      else this.cells.set(key, [item]);
    }
  }

  /** Every item within the radius of `place`, nearest first. */
  within(place: LatLng): T[] {
    const row = this.row(place.lat);
    const col = this.col(place.lng);
    // A degree of longitude is shorter than one of latitude, so the radius spans more columns than rows.
    const cols = Math.ceil(1 / Math.cos((place.lat * Math.PI) / 180));
    const found: { item: T; d: number }[] = [];
    for (let r = row - 1; r <= row + 1; r++) {
      for (let c = col - cols; c <= col + cols; c++) {
        for (const item of this.cells.get(this.key(r, c)) ?? []) {
          const d = distanceM(place, item.location);
          if (d <= this.radiusM) found.push({ item, d });
        }
      }
    }
    return found.sort((a, b) => a.d - b.d).map((f) => f.item);
  }

  private row(lat: number) {
    return Math.floor(lat / this.cellDeg);
  }
  private col(lng: number) {
    return Math.floor(lng / this.cellDeg);
  }
  private key(row: number, col: number) {
    return `${row}:${col}`;
  }
}
