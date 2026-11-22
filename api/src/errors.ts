import type { FastifyError, FastifyInstance } from 'fastify';

export function registerErrorHandlers(app: FastifyInstance): void {
    app.setErrorHandler((error: FastifyError, request, reply) => {
      
    if (error instanceof AppError) {
        return reply.code(error.statusCode).send({
            error: { code: error.code, message: error.message, details: error.details },
    });
    }   
    // Case 1: schema validation failed
    if (error.validation) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          details: error.validation.map((v) => ({
            field: v.instancePath.slice(1) || String(v.params?.missingProperty ?? ''),
            issue: v.message ?? 'invalid value',
          })),
        },
      });
    }

    // Case 2: any other client error Fastify raised itself (4xx), e.g. malformed JSON body
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: { code: 'BAD_REQUEST', message: error.message } });
    }

    // Case 3: everything else is OUR bug or a dependency failing → 500
    request.log.error({ err: error }, 'unhandled error');      // full detail goes to the server log only
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
    });
  });
}

// in errors.ts
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: { field: string; issue: string }[],
  ) {
    super(message);
  }
}