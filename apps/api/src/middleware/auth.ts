import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { HttpError } from "../lib/errors.js";

export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth: AuthContext;
    }
  }
}

export function signToken(payload: { userId: string; workspaceId: string }) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string) {
  return jwt.verify(token, config.jwtSecret) as { userId: string; workspaceId: string };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw new HttpError(401, "No autenticado");
    let payload: { userId: string; workspaceId: string };
    try {
      payload = verifyToken(token);
    } catch {
      throw new HttpError(401, "Sesión inválida o expirada");
    }
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: payload.userId, workspaceId: payload.workspaceId } },
    });
    if (!membership) throw new HttpError(403, "Sin acceso a este workspace");
    req.auth = { userId: payload.userId, workspaceId: payload.workspaceId, role: membership.role };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!roles.includes(req.auth.role)) return next(new HttpError(403, "Permisos insuficientes"));
    next();
  };
}
