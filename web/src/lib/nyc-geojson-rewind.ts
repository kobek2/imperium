import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";

/** Reverse a ring so d3-geo treats the local feature as the interior, not its planetary complement. */
function reverseRing(ring: Position[]): Position[] {
  return ring.slice().reverse();
}

function rewindGeometry(geometry: Polygon | MultiPolygon): Polygon | MultiPolygon {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map(reverseRing),
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) => polygon.map(reverseRing)),
  };
}

/** Borough/district exports were simplified with clockwise rings — rewind for RFC 7946 + d3-geo. */
export function rewindFeatureCollection<P extends Record<string, unknown>>(
  collection: FeatureCollection<Polygon | MultiPolygon, P>,
): FeatureCollection<Polygon | MultiPolygon, P> {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => ({
      ...feature,
      geometry: rewindGeometry(feature.geometry),
    })),
  };
}
