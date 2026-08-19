import { Router } from "express";
import { credentialsSchema } from "../domain/dto";
import { validateBody } from "../middleware/validate";
import { requireAuth } from "../middleware/auth.middleware";
import { authService } from "../services/auth.service";

export const authRouter = Router();

authRouter.post(
  "/auth/register",
  validateBody(credentialsSchema),
  async (req, res, next) => {
    try {
      const user = await authService.register(req.body.email, req.body.password);
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  "/auth/login",
  validateBody(credentialsSchema),
  async (req, res, next) => {
    try {
      const result = await authService.login(req.body.email, req.body.password);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
