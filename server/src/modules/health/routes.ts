import { Router } from "express";

export function healthRouter(isDbReady: () => boolean): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ data: { status: "ok" } });
  });

  router.get("/ready", (_req, res) => {
    const ready = isDbReady();
    res.status(ready ? 200 : 503).json({ data: { status: ready ? "ok" : "down" } });
  });

  return router;
}
