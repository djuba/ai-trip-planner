// The sample route data (backends/api-nextjs/data/routes.json; WU-10 plan D4), bundled by Next and
// parsed on first use, so a malformed file fails the first /recommend request with a clear error.
import routesJson from '../../data/routes.json' with { type: 'json' };
import { parseRouteData, type RouteData } from '../usecases/routes.ts';

let routes: RouteData | undefined;

export function getRouteData(): RouteData {
  routes ??= parseRouteData(routesJson);
  return routes;
}
