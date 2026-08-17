import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { HttpError } from "../domain/errors";
import { userRepository } from "../repositories/user.repository";

export interface PublicUser {
  id: string;
  email: string;
}

export const authService = {
  verifyToken(token: string): PublicUser {
    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    return { id: String(payload.sub), email: String(payload.email) };
  },

  async register(email: string, password: string): Promise<PublicUser> {
    if (await userRepository.findByEmail(email)) {
      throw new HttpError(409, "email already registered");
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await userRepository.create(email, passwordHash);
    return { id: user.id, email: user.email };
  },

  async login(email: string, password: string): Promise<{ token: string }> {
    const user = await userRepository.findByEmail(email);
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) {
      throw new HttpError(401, "invalid credentials");
    }
    const token = jwt.sign({ email: user.email }, env.JWT_SECRET, {
      subject: user.id,
      expiresIn: env.JWT_EXPIRES_SECONDS,
    });
    return { token };
  },
};
