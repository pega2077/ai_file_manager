import type { Request, Response, NextFunction } from "express";

// Route handlers for system-level operations
const status = (_req: Request, res: Response) => {
  res.json({ status: "healthy" });
};

export const registerSystemRoutes = (app: {
  get: (path: string, handler: (req: Request, res: Response, next?: NextFunction) => void) => unknown;
}) => {
  // Health endpoints
  app.get("/api/system/status", status);
};
