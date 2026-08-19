import { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth.service";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing bearer token" });
  }
  try {
    req.user = authService.verifyToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
}
