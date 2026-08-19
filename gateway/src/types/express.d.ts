declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
      connector?: { id: string; user_id: string; target_id: string };
    }
  }
}

export {};
