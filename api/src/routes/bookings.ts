import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { createBooking, type NewBooking, type BookingRow } from '../repositories/bookings.js';
import { AppError } from '../errors.js';
import {getBookingById} from '../repositories/bookings.js'


// schema of api which defines what client is allowed to send
const createBookingSchema = {
    type: 'object',
    required: ['flight_id', 'contact_email', 'passengers'],
    additionalProperties: false,
    properties: {
        flight_id: { type: 'string', pattern: '^FL-[0-9]+$' },
        contact_email: { type: 'string', format: 'email', maxLength: 254 },
        passengers: {
            type: 'array',
            minItems: 1,
            maxItems: 9,
            items: {
                type: 'object',
                required: ['full_name'],
                additionalProperties: false,
                properties: {
                    full_name: { type: 'string', minLength: 1, maxLength: 100 },
                },
            }
        }
    }
} as const;

interface Booking {
  booking_id: string;
  flight_id: string;
  seats: number;
  total_price_usd: number;      // number in the API
  status: string;
  contact_email: string;
  passengers: { full_name: string }[];
  created_at: string;           // ISO string in the API
  is_synthetic: boolean;
}

function toBooking(row: BookingRow): Booking {
  return {
    booking_id: row.booking_id,
    flight_id: row.flight_id,
    seats: row.seats,
    total_price_usd: Number(row.total_price_usd),
    status: row.status,
    contact_email: row.contact_email,
    passengers: row.passengers,
    created_at: row.created_at.toISOString(),
    is_synthetic: row.is_synthetic,
  };
}

export const bookingRoutes: FastifyPluginAsync<{ pool: Pool }> = async (app, opts) => {
    const bookingParamsSchema = {
    type: 'object',
    required: ['booking_id'],
    properties: {
        booking_id: { type: 'string', pattern: '^BK-[0-9]+$' },
    },
    } as const;
    app.post<{ Body: NewBooking }>(
    '/api/bookings',
    { schema: { body: createBookingSchema } },
    async (request, reply) => {
    //   if (!booking) {
    //     throw new AppError(409, `SOLD_OUT`, 'Not enough seats');   // Part B splits this into 404 vs 409
        //   }
        const result = await createBooking(opts.pool, request.body);
        switch (result.status) {
            case 'not_found':
                throw new AppError(404, 'NOT_FOUND', `Flight ${request.body.flight_id} not found`);
            case 'sold_out':
                throw new AppError(409, 'SOLD_OUT', `Only ${result.seatsLeft} seat(s) left on ${request.body.flight_id}`);
            case 'created':
                return reply
                    .code(201)
                    .header('Location', `/api/bookings/${result.booking.booking_id}`)
                    .send(toBooking(result.booking));
        }
        
    },
    );
    app.get<{ Params: { booking_id: string } }>(            // a GET route; tells TypeScript the URL has a booking_id
        '/api/bookings/:booking_id', { schema: { params: bookingParamsSchema } },
        async (request) => {
        const row = await getBookingById(opts.pool, request.params.booking_id);  // look it up in the DB
        if (!row) {                                                              // nothing found?
            throw new AppError(404, 'NOT_FOUND', `Booking ${request.params.booking_id} not found`);  // → 404
        }
            return toBooking(row);                         // found → 200 with the booking as JSON
    },
    );
};