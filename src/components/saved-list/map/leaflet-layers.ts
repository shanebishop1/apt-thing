import type {
  DivIcon,
  LatLngBoundsExpression,
  LayerGroup,
  Map as LeafletMap,
  Marker,
} from "leaflet";
import { formatMoney } from "../listing-presentation";
import { createMapReviewModel, type MapReviewCandidate } from "../../../lib/map-review";
import type { GroceryStoreLocation } from "./geographic-data";
import { groceryStoreLocations } from "./geographic-data";

export type LeafletModule = typeof import("leaflet");
type LeafletGeoJsonInput = Parameters<LeafletModule["geoJSON"]>[0];

export type LeafletSyncResult = {
  groceryMarkers: Marker[];
  listingMarkers: Marker[];
};

const MTA_SUBWAY_FEATURE_SERVICE =
  "https://services5.arcgis.com/OKgEWPlJhc3vFb8C/arcgis/rest/services/MTA_Subway_Routes_Stops/FeatureServer";
const MTA_SUBWAY_STATIONS_LAYER = 0;
const MTA_SUBWAY_ROUTES_LAYER = 1;

type SubwayGeoJsonFeature = {
  properties?: Record<string, unknown>;
};

export function syncLeafletMap({
  leaflet,
  fitToListings,
  map,
  model,
  onSelect,
  selectedId,
}: {
  leaflet: LeafletModule;
  fitToListings: boolean;
  map: LeafletMap;
  model: ReturnType<typeof createMapReviewModel>;
  onSelect: (listingId: string) => void;
  selectedId?: string;
}): LeafletSyncResult {
  const groceryMarkers = groceryStoreLocations.map((store) => {
    const marker = leaflet
      .marker([store.latitude, store.longitude], {
        icon: createGroceryLeafletIcon(leaflet, store),
        keyboard: true,
        title: `${store.name} grocery context`,
        zIndexOffset: -120,
      })
      .addTo(map);

    marker.bindPopup(createGroceryPopup(store));
    return marker;
  });

  const listingMarkers = model.locatedCandidates.map((candidate, index) => {
    const marker = leaflet
      .marker([candidate.coordinates!.latitude, candidate.coordinates!.longitude], {
        icon: createListingLeafletIcon(
          leaflet,
          candidate,
          index + 1,
          candidate.listing.id === selectedId,
        ),
        keyboard: true,
        title: candidate.listing.title,
      })
      .addTo(map);

    marker.bindPopup(createListingPopup(candidate));
    marker.on("click", () => onSelect(candidate.listing.id));
    return marker;
  });

  if (fitToListings && model.locatedCandidates.length > 0) {
    const bounds = model.locatedCandidates.map((candidate) => [
      candidate.coordinates!.latitude,
      candidate.coordinates!.longitude,
    ]) as LatLngBoundsExpression;
    map.fitBounds(bounds, { maxZoom: 14, padding: [34, 34] });
  }

  return { groceryMarkers, listingMarkers };
}

export async function addMtaSubwayOverlay(
  leaflet: LeafletModule,
  map: LeafletMap,
): Promise<LayerGroup> {
  const overlay = leaflet.layerGroup().addTo(map);
  const [routes, stations] = await Promise.all([
    fetchSubwayGeoJson(MTA_SUBWAY_ROUTES_LAYER),
    fetchSubwayGeoJson(MTA_SUBWAY_STATIONS_LAYER),
  ]);

  leaflet
    .geoJSON(routes, {
      onEachFeature: (feature, layer) => {
        const properties = getFeatureProperties(feature);
        const route =
          getPropertyText(properties, "route_shor") || getPropertyText(properties, "route_id");
        const name = getPropertyText(properties, "route_long");
        layer.bindPopup(
          `<strong>${escapeHtml(route || "Subway route")}</strong><br>${escapeHtml(
            name || "MTA subway route",
          )}<br>Source: MTA Subway Routes & Stops`,
        );
      },
      style: (feature) => {
        const properties = getFeatureProperties(feature);
        const color = normalizeRouteColor(getPropertyText(properties, "color"));
        return {
          color,
          interactive: true,
          opacity: 0.82,
          weight: 4,
        };
      },
    })
    .addTo(overlay);

  leaflet
    .geoJSON(stations, {
      onEachFeature: (feature, layer) => {
        const properties = getFeatureProperties(feature);
        const station = getPropertyText(properties, "stop_name") || "Subway station";
        const trains = getPropertyText(properties, "trains") || "Routes unavailable";
        layer.bindPopup(
          `<strong>${escapeHtml(station)}</strong><br>Routes: ${escapeHtml(
            trains,
          )}<br>Source: MTA Subway Routes & Stops`,
        );
      },
      pointToLayer: (feature, latlng) => {
        const properties = getFeatureProperties(feature);
        const trains = getPropertyText(properties, "trains");
        return leaflet.circleMarker(latlng, {
          className: "leaflet-subway-station",
          color: "#1e1915",
          fillColor: normalizeRouteColor(firstRouteColor(trains)),
          fillOpacity: 0.96,
          opacity: 0.86,
          radius: 4.5,
          weight: 1.5,
        });
      },
    })
    .addTo(overlay);

  return overlay;
}

export function trackLeafletContainerSize(container: HTMLDivElement, map: LeafletMap) {
  let animationFrameId: number | undefined;
  const timeoutIds: number[] = [];

  const invalidateSize = () => {
    if (!container.isConnected || container.clientWidth === 0 || container.clientHeight === 0) {
      return;
    }

    map.invalidateSize({ pan: false });
  };

  const scheduleInvalidateSize = () => {
    if (animationFrameId !== undefined) {
      window.cancelAnimationFrame(animationFrameId);
    }

    animationFrameId = window.requestAnimationFrame(() => {
      animationFrameId = undefined;
      invalidateSize();
    });
  };

  const resizeObserver =
    typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleInvalidateSize);
  resizeObserver?.observe(container);

  scheduleInvalidateSize();
  timeoutIds.push(window.setTimeout(scheduleInvalidateSize, 120));
  timeoutIds.push(window.setTimeout(scheduleInvalidateSize, 420));

  return () => {
    resizeObserver?.disconnect();
    timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    if (animationFrameId !== undefined) {
      window.cancelAnimationFrame(animationFrameId);
    }
  };
}

function createListingLeafletIcon(
  leaflet: LeafletModule,
  candidate: MapReviewCandidate,
  label: number,
  selected: boolean,
): DivIcon {
  return leaflet.divIcon({
    className: "",
    html: `<span class="leaflet-listing-pin ${candidate.pinState}${selected ? " selected" : ""}"><span class="leaflet-listing-pin-label">${label}</span></span>`,
    iconAnchor: [16, 39],
    iconSize: [32, 40],
    popupAnchor: [0, -39],
  });
}

function createGroceryLeafletIcon(leaflet: LeafletModule, store: GroceryStoreLocation): DivIcon {
  const brandLabel = store.brand === "whole-foods" ? "Whole Foods" : "Trader Joe's";
  const logoText = store.brand === "whole-foods" ? "Whole\nFoods" : "Trader\nJoe's";

  return leaflet.divIcon({
    className: "",
    html: `<span class="leaflet-grocery-pin ${store.brand}" aria-label="${escapeHtml(
      `${brandLabel} location`,
    )}"><span>${escapeHtml(logoText)}</span></span>`,
    iconAnchor: [9, 9],
    iconSize: [18, 18],
    popupAnchor: [0, -10],
  });
}

function createListingPopup(candidate: MapReviewCandidate): string {
  return `<strong>${escapeHtml(candidate.listing.title)}</strong><br>${escapeHtml(
    candidate.listing.address,
  )}<br>${escapeHtml(formatMoney(candidate.listing.rent))} · ${candidate.listing.bedrooms ?? "?"} beds`;
}

function createGroceryPopup(store: GroceryStoreLocation): string {
  const sourceLabel =
    store.brand === "whole-foods" ? "Whole Foods store page" : "Trader Joe's store page";
  return `<strong>${escapeHtml(store.name)}</strong><br>${escapeHtml(store.address)}<br>${escapeHtml(
    store.borough,
  )}<br><a href="${escapeHtml(store.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(
    sourceLabel,
  )}</a>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function fetchSubwayGeoJson(layerId: number): Promise<LeafletGeoJsonInput> {
  const response = await fetch(
    `${MTA_SUBWAY_FEATURE_SERVICE}/${layerId}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load MTA subway layer ${layerId}: ${response.status}`);
  }

  return response.json() as Promise<LeafletGeoJsonInput>;
}

function getFeatureProperties(feature: unknown): Record<string, unknown> {
  return ((feature as SubwayGeoJsonFeature | undefined)?.properties ?? {}) as Record<
    string,
    unknown
  >;
}

function getPropertyText(properties: Record<string, unknown>, key: string): string {
  const value = properties[key];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizeRouteColor(value: string): string {
  const color = value.replace(/^#/, "").trim();
  return /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : "#6b6257";
}

function firstRouteColor(routes: string): string {
  const route =
    routes
      .split(/[\s,/]+/)
      .find(Boolean)
      ?.toUpperCase() ?? "";
  const colors: Record<string, string> = {
    "1": "EE352E",
    "2": "EE352E",
    "3": "EE352E",
    "4": "00933C",
    "5": "00933C",
    "6": "00933C",
    "7": "B933AD",
    A: "0039A6",
    C: "0039A6",
    E: "0039A6",
    B: "FF6319",
    D: "FF6319",
    F: "FF6319",
    M: "FF6319",
    G: "6CBE45",
    J: "996633",
    Z: "996633",
    L: "A7A9AC",
    N: "FCCC0A",
    Q: "FCCC0A",
    R: "FCCC0A",
    W: "FCCC0A",
    S: "808183",
  };
  return colors[route] ?? "6b6257";
}
