import { useEffect, useState } from "react";

export type Route = { page: "join" } | { page: "room"; code: string };

export function parseRoute(pathname: string): Route {
  const m = /^\/r\/([A-Za-z0-9]{4,8})\/?$/.exec(pathname);
  if (m?.[1]) return { page: "room", code: m[1].toUpperCase() };
  return { page: "join" };
}

export function navigate(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return route;
}
