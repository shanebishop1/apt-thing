import { NextRequest, NextResponse } from "next/server";
import { authorizeGroupRequest } from "@/lib/api-auth";
import { jsonError, readCloudflareEnv, readServerSecret } from "@/lib/route-support";

type MapTileRouteEnv = Partial<Record<"STADIA_MAPS_API_KEY", unknown>>;

const tileCoordinatePattern = /^\d+$/;
const tileFilePattern = /^(\d+)(@2x)?\.png$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const auth = await authorizeGroupRequest(request, { displayName: "Map Tiles API" });
  if (!auth.ok) return auth.response;

  const { z, x, y } = await params;
  const yMatch = tileFilePattern.exec(y);

  if (!tileCoordinatePattern.test(z) || !tileCoordinatePattern.test(x) || !yMatch) {
    return jsonError(400, "invalid-tile-coordinates");
  }

  const zoom = Number(z);
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 20) {
    return jsonError(400, "invalid-tile-zoom");
  }

  const env = await readCloudflareEnv<MapTileRouteEnv>();
  const apiKey = readServerSecret(env, "STADIA_MAPS_API_KEY")?.trim() ?? "";

  const retinaSuffix = yMatch[2] ?? "";
  if (apiKey) {
    const tileUrl = new URL(
      `https://tiles.stadiamaps.com/tiles/alidade_smooth/${z}/${x}/${yMatch[1]}${retinaSuffix}.png`,
    );
    tileUrl.searchParams.set("api_key", apiKey);

    const upstream = await fetch(tileUrl, {
      headers: {
        accept: "image/png,image/*;q=0.8,*/*;q=0.5",
        origin: request.nextUrl.origin,
        referer: `${request.nextUrl.origin}/`,
      },
    });

    if (upstream.ok && upstream.body) {
      return tileResponse(upstream);
    }
  }

  const fallback = await fetch(
    `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${yMatch[1]}.png`,
    { headers: { accept: "image/png,image/*;q=0.8,*/*;q=0.5" } },
  );

  if (!fallback.ok || !fallback.body) {
    return jsonError(fallback.status, "tile-fetch-failed");
  }

  return tileResponse(fallback);
}

function tileResponse(response: Response) {
  return new NextResponse(response.body, {
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
      "Content-Type": response.headers.get("content-type") ?? "image/png",
    },
    status: response.status,
  });
}
