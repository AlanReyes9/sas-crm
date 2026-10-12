export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Recurso") => new HttpError(404, `${what} no encontrado`);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
