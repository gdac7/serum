import { Request, Response, NextFunction } from "express";
import { connectorService } from "../services/connector.service";

// The connector runs on a user's machine and cannot hold a JWT: it is started
// once from a command line and has to keep working unattended. It presents a
// per-target token instead, which authorises exactly one target's traffic.
export async function requireConnector(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing connector token" });
  }
  try {
    const connector = await connectorService.authenticate(header.slice(7));
    if (!connector) {
      return res.status(401).json({ error: "invalid or revoked connector token" });
    }
    req.connector = connector;
    next();
  } catch (err) {
    next(err);
  }
}
