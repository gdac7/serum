import { apiRequest } from "./client";

export interface AuthUser {
  id: string;
  email: string;
}

export const authApi = {
  register: (email: string, password: string) =>
    apiRequest<AuthUser>("POST", "/auth/register", null, { email, password }),

  login: (email: string, password: string) =>
    apiRequest<{ token: string }>("POST", "/auth/login", null, { email, password }),

  me: (token: string) => apiRequest<{ user: AuthUser }>("GET", "/me", token),
};
