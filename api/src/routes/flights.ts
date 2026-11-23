import type { FastifyPluginAsync } from 'fastify';
import { searchFlights, getFlightById, type FlightRow } from '../repositories/flights.js';
import type { Pool } from 'pg';
import { AppError } from '../errors.js';

const AIRPORTS = ['JFK', 'LAX', 'SFO', 'MIA', 'ORD'] as const;
type Airport = (typeof AIRPORTS)[number];

interface SearchQuery {
  origin: Airport;
  destination: Airport;
  date?: string;      // optional: no default in the schema
  limit: number;      // always present, because of `default`
  offset: number;
  sort: 'price' | 'departure';   // or SortOrder; always present because of `default`
  include_full: boolean;         // always present because of `default`
  max_price?: number;            // optional: no default
}


interface Flight {
    flight_id: string;
    airline: string;
    airline_code: string;
    flight_number: string;
    origin: string;
    destination: string;
    departure_time: string;   // ISO 8601, e.g. "2027-03-15T06:05:00.000Z"
    arrival_time: string;
    duration_minutes: number;
    price_usd: number;        // number, not string
    available_seats: number;
    is_synthetic: boolean;

}

function toFlight(row: FlightRow): Flight {
  return {
    flight_id: row.flight_id,
    airline: row.airline,
    airline_code: row.airline_code,
    flight_number: row.flight_number,
    origin: row.origin,
    destination: row.destination,
    departure_time: row.departure_time.toISOString(),
    arrival_time: row.arrival_time.toISOString(),
    duration_minutes: row.duration_minutes,
    price_usd: Number(row.price_usd),
    available_seats: row.available_seats,
    is_synthetic: row.is_synthetic,
  };

}
//API endpoint to edit
const searchQuerySchema = {
  type: 'object',
  required: ['origin', 'destination'],
  additionalProperties: false,          // reject unknown params like ?orgin=JFK (typo)
  properties: {
    origin:      { type: 'string', enum: AIRPORTS },
    destination: { type: 'string', enum: AIRPORTS },
    date:        { type: 'string', format: 'date' },
    limit:       { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    offset: { type: 'integer', minimum: 0, default: 0 },
    sort:         { type: 'string', enum: ['price', 'departure'], default: 'price' },
    include_full: { type: 'boolean', default: false },
    max_price:    { type: 'number', minimum: 0 },
  },
} as const;

const flightParamsSchema = {
  type: 'object',
  required: ['flight_id'],
  properties: {
    flight_id: { type: 'string', pattern: `^FL-[0-9]+$` },
  },
} as const;

// defining the api endpoints '/api/flights'
export const flightRoutes: FastifyPluginAsync<{ pool: Pool }> = async (app, opts) => {
  app.get<{ Querystring: SearchQuery }>(
    '/api/flights',
    { schema: { querystring: searchQuerySchema } },
    async (request, reply) => {
      const { origin, destination } = request.query;
      if (origin === destination) {
        throw new AppError(400, 'VALIDATION_ERROR', 'origin and destination must differ', [
            { field: 'destination', issue: 'must differ from origin' },
        ]);
      }
      const { limit, offset } = request.query;
      const { rows, total } = await searchFlights(opts.pool, request.query);
      return {
        data: rows.map(toFlight),
        pagination: { limit, offset, total },
      };
    },
  );
  
    
// defining the API endpoints /api/flights/:flight_id'
  app.get<{ Params: { flight_id: string } }>(
  '/api/flights/:flight_id',
  { schema: { params: flightParamsSchema } },
  async (request) => {
    const row = await getFlightById(opts.pool, request.params.flight_id);
    if (!row) {
      throw new AppError(404, 'NOT_FOUND', `Flight ${request.params.flight_id} not found`);
    }
    return toFlight(row);
  },
);
};

