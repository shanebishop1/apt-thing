"use client";

import { useEffect, useRef } from "react";
import type { LayerGroup, Map as LeafletMap, Marker } from "leaflet";
import type { InviteIdentity, ListingCandidate } from "@/lib/listings";
import { createMapReviewModel } from "@/lib/map-review";
import {
  addMtaSubwayOverlay,
  syncLeafletMap,
  trackLeafletContainerSize,
  type LeafletModule,
} from "./leaflet-layers";

function createLeafletTileUrl(identity?: InviteIdentity) {
  if (!identity) return "";

  // Tiles authenticate with the HTTP-only group session cookie, so the URL carries no credential.
  return "/api/map/tiles/{z}/{x}/{y}.png";
}

export function LeafletListingMap({
  identity,
  model,
  selectedId,
  onSelect,
  className = "leaflet-map",
}: {
  identity?: InviteIdentity;
  model: ReturnType<typeof createMapReviewModel>;
  selectedId?: string;
  onSelect: (listingId: string) => void;
  className?: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<LeafletMap | null>(null);
  const groceryMarkersRef = useRef<Marker[]>([]);
  const listingMarkersRef = useRef<Marker[]>([]);
  const subwayOverlayRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const stopResizeTrackingRef = useRef<(() => void) | null>(null);
  const tileUrl = createLeafletTileUrl(identity);

  useEffect(() => {
    const mapContainer = mapContainerRef.current;
    if (!mapContainer || leafletMapRef.current || !tileUrl) {
      return;
    }

    let disposed = false;

    void import("leaflet").then((leaflet) => {
      if (disposed || !mapContainerRef.current) {
        return;
      }

      leafletRef.current = leaflet;
      const map = leaflet.map(mapContainerRef.current, {
        attributionControl: false,
        center: [40.7328, -73.9797],
        scrollWheelZoom: true,
        zoom: 13,
        zoomControl: true,
      });

      leaflet
        .tileLayer(tileUrl, {
          attribution: "",
          detectRetina: false,
          maxZoom: 20,
        })
        .addTo(map);
      leafletMapRef.current = map;
      const nextMarkers = syncLeafletMap({
        fitToListings: true,
        leaflet,
        map,
        model,
        onSelect,
        selectedId,
      });
      listingMarkersRef.current = nextMarkers.listingMarkers;
      groceryMarkersRef.current = nextMarkers.groceryMarkers;
      void addMtaSubwayOverlay(leaflet, map)
        .then((overlay) => {
          if (disposed) {
            overlay.remove();
            return;
          }

          subwayOverlayRef.current = overlay;
        })
        .catch((error: unknown) => {
          console.error("MTA subway overlay failed to load", error);
        });
      stopResizeTrackingRef.current = trackLeafletContainerSize(mapContainerRef.current, map);
    });

    return () => {
      disposed = true;
      stopResizeTrackingRef.current?.();
      stopResizeTrackingRef.current = null;
      groceryMarkersRef.current.forEach((marker) => marker.remove());
      listingMarkersRef.current.forEach((marker) => marker.remove());
      subwayOverlayRef.current?.remove();
      groceryMarkersRef.current = [];
      listingMarkersRef.current = [];
      subwayOverlayRef.current = null;
      leafletMapRef.current?.remove();
      leafletMapRef.current = null;
    };
  }, [tileUrl]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = leafletMapRef.current;
    if (!leaflet || !map) {
      return;
    }

    groceryMarkersRef.current.forEach((marker) => marker.remove());
    listingMarkersRef.current.forEach((marker) => marker.remove());
    const nextMarkers = syncLeafletMap({
      fitToListings: false,
      leaflet,
      map,
      model,
      onSelect,
      selectedId,
    });
    groceryMarkersRef.current = nextMarkers.groceryMarkers;
    listingMarkersRef.current = nextMarkers.listingMarkers;
  }, [model, onSelect, selectedId]);

  return <div ref={mapContainerRef} className={className} />;
}

export function ListingInlineMap({
  identity,
  listing,
}: {
  identity?: InviteIdentity;
  listing: ListingCandidate;
}) {
  const model = createMapReviewModel([listing], listing.id);

  return (
    <div className="listing-inline-map-shell" aria-label={`Interactive map for ${listing.title}`}>
      <LeafletListingMap
        identity={identity}
        model={model}
        selectedId={listing.id}
        onSelect={noopSelectListing}
        className="listing-inline-map"
      />
    </div>
  );
}

const noopSelectListing = () => {};
