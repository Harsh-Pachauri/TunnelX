import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
});

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'must be a valid date',
});

export const logsQuerySchema = z.object({
  tunnelId: z.string().uuid().optional(),
  // exact 3-digit code (e.g. "404") or a class (e.g. "2xx", "5xx")
  status: z
    .string()
    .regex(/^([1-5]\d{2}|[1-5]xx)$/i, { message: 'status must be a 3-digit code (e.g. 404) or a class (e.g. 5xx)' })
    .optional(),
  method: z.string().min(1).max(10).optional(),
  path: z.string().min(1).max(500).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
