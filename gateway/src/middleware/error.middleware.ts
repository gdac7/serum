import { Request, Response, NextFunction } from "express";
import { HttpError } from "../domain/errors";
import { logger } from "../infra/logger";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: "internal server error" });
}
