import { z } from 'zod';

const uuid = z.string().uuid();
const dateOnly = z.string().date();
const lifecycleStatus = z.enum(['ACTIVE', 'INACTIVE', 'RETIRED']);
const operationalStatus = z.enum([
  'AVAILABLE',
  'RESERVED',
  'RENTED',
  'MAINTENANCE',
  'INACTIVE',
]);
const vehicleCategory = z.enum([
  'SEDAN',
  'HATCHBACK',
  'SUV',
  'VAN',
  'PICKUP',
  'WAGON',
  'COUPE',
  'OTHER',
]);
const fuelType = z.enum(['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'LPG', 'OTHER']);
const transmission = z.enum(['MANUAL', 'AUTOMATIC', 'OTHER']);
const driveType = z.enum(['FWD', 'RWD', 'AWD', 'FOUR_WD', 'OTHER']);
const trimmedString = (max) => z.string().trim().min(1).max(max);

const specificationSchema = z.object({
  make: trimmedString(80),
  model: trimmedString(100),
  variant: z.string().trim().max(100).nullable().optional(),
  category: vehicleCategory,
  manufacturingYear: z.number().int().min(1886).max(2100).nullable().optional(),
  engineCapacityCc: z.number().int().min(0).max(65535).nullable().optional(),
  fuelType,
  transmission,
  colour: z.string().trim().max(50).nullable().optional(),
  seatingCapacity: z.number().int().min(1).max(255).nullable().optional(),
  numberOfDoors: z.number().int().min(0).max(255).nullable().optional(),
  bodyType: z.string().trim().max(60).nullable().optional(),
  driveType: driveType.nullable().optional(),
  hasAirConditioning: z.boolean().nullable().optional(),
  features: z.array(trimmedString(80)).max(80).optional(),
});
const updateSpecificationSchema = specificationSchema.partial().extend({
  category: vehicleCategory.nullable().optional(),
});

const vehicleFields = {
  registrationNumber: trimmedString(24),
  vin: z.string().trim().max(64).nullable().optional(),
  chassisNumber: z.string().trim().max(64).nullable().optional(),
  engineNumber: z.string().trim().max(64).nullable().optional(),
  acquisitionDate: dateOnly.nullable().optional(),
  description: z.string().trim().max(12_000).nullable().optional(),
  publicDescription: z.string().trim().max(12_000).nullable().optional(),
  internalNotes: z.string().trim().max(12_000).nullable().optional(),
};

const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const publicVehicleListSchema = z.object({
  query: z.object({
    ...pageFields,
    search: z.string().trim().max(100).optional(),
    category: vehicleCategory.optional(),
    fuelType: fuelType.optional(),
    transmission: transmission.optional(),
    seatingCapacity: z.coerce.number().int().min(1).max(255).optional(),
    maxPrice: z.coerce.number().min(0).max(1_000_000_000).optional(),
    sort: z.enum(['newest', 'name', 'year_desc']).default('newest'),
  }),
});

export const vehicleListSchema = z.object({
  query: z.object({
    ...pageFields,
    search: z.string().trim().max(100).optional(),
    status: operationalStatus.optional(),
    lifecycleStatus: lifecycleStatus.optional(),
    category: vehicleCategory.optional(),
    make: z.string().trim().max(80).optional(),
    model: z.string().trim().max(100).optional(),
    fuelType: fuelType.optional(),
    transmission: transmission.optional(),
    yearFrom: z.coerce.number().int().min(1886).max(2100).optional(),
    yearTo: z.coerce.number().int().min(1886).max(2100).optional(),
    seatingCapacity: z.coerce.number().int().min(1).max(255).optional(),
    priceFrom: z.coerce.number().min(0).max(1_000_000_000).optional(),
    priceTo: z.coerce.number().min(0).max(1_000_000_000).optional(),
    documentExpiry: z.enum(['expiring', 'expired', 'missing']).optional(),
    maintenance: z.enum(['due', 'overdue', 'in_progress']).optional(),
    availableFrom: z.string().datetime({ offset: true }).optional(),
    availableTo: z.string().datetime({ offset: true }).optional(),
    sortBy: z
      .enum(['registration', 'makeModel', 'year', 'mileage', 'createdAt'])
      .default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }).superRefine((query, context) => {
    if (query.yearFrom !== undefined && query.yearTo !== undefined && query.yearFrom > query.yearTo) {
      context.addIssue({ code: 'custom', path: ['yearFrom'], message: 'Year range is invalid.' });
    }
    if (query.priceFrom !== undefined && query.priceTo !== undefined && query.priceFrom > query.priceTo) {
      context.addIssue({ code: 'custom', path: ['priceFrom'], message: 'Price range is invalid.' });
    }
    if ((query.availableFrom && !query.availableTo) || (!query.availableFrom && query.availableTo)) {
      context.addIssue({
        code: 'custom',
        path: ['availableTo'],
        message: 'Both availability dates are required.',
      });
    }
    if (
      query.availableFrom &&
      query.availableTo &&
      Date.parse(query.availableFrom) >= Date.parse(query.availableTo)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['availableTo'],
        message: 'Availability end must be after its start.',
      });
    }
  }),
});

export const createVehicleSchema = z.object({
  body: z.object({
    ...vehicleFields,
    currentOdometerKm: z.number().int().min(0).max(4_294_967_295).optional(),
    initialOdometerReason: z.string().trim().min(1).max(1000).optional(),
    specification: specificationSchema,
  }).superRefine((body, context) => {
    if (body.currentOdometerKm !== undefined && !body.initialOdometerReason) {
      context.addIssue({
        code: 'custom',
        path: ['initialOdometerReason'],
        message: 'Explain the source of the initial odometer reading.',
      });
    }
  }),
});

export const updateVehicleSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    ...Object.fromEntries(
      Object.entries(vehicleFields).map(([key, schema]) => [key, schema.optional()]),
    ),
    isPublished: z.boolean().optional(),
    specification: updateSpecificationSchema
      .refine((fields) => Object.keys(fields).length > 0, 'Provide at least one specification field.')
      .optional(),
  }).refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update.'),
});

export const updateVehiclePublicationSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({ isPublished: z.boolean() }).strict(),
});

export const vehicleIdSchema = z.object({ params: z.object({ id: uuid }) });

export const updateVehicleStatusSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    status: lifecycleStatus,
    reason: trimmedString(1000),
  }),
});

export const archiveVehicleSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({ reason: trimmedString(1000) }),
});

export const mileageListSchema = z.object({
  params: z.object({ id: uuid }),
  query: z.object({
    page: pageFields.page,
    limit: pageFields.limit,
  }),
});

export const createMileageReadingSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    readingKm: z.number().int().min(0).max(4_294_967_295),
    reason: trimmedString(1000),
  }),
});

export const mileageCorrectionSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    readingKm: z.number().int().min(0).max(4_294_967_295),
    reason: trimmedString(1000),
  }),
});

export const imageIdSchema = z.object({
  params: z.object({ id: uuid, imageId: uuid }),
});

export const reorderVehicleImagesSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    imageIds: z.array(uuid).min(1).max(50).refine(
      (imageIds) => new Set(imageIds).size === imageIds.length,
      'Image identifiers must not be repeated.',
    ),
  }),
});

export const updateVehicleImageSchema = z.object({
  params: z.object({ id: uuid, imageId: uuid }),
  body: z.object({
    caption: z.string().trim().max(255).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isPrimary: z.boolean().optional(),
    isPublished: z.boolean().optional(),
  }).refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update.'),
});

export const createVehicleDocumentSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    documentType: z.enum([
      'REGISTRATION',
      'INSURANCE',
      'REVENUE_LICENSE',
      'EMISSION_CERTIFICATE',
      'PURCHASE_DOCUMENT',
      'SERVICE_RECORD',
      'OTHER',
    ]),
    issueDate: dateOnly.optional(),
    expiresAt: dateOnly.optional(),
  }).superRefine((body, context) => {
    if (body.issueDate && body.expiresAt && body.expiresAt < body.issueDate) {
      context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiry date cannot precede issue date.' });
    }
  }),
});

export const vehicleDocumentParamsSchema = z.object({
  params: z.object({ id: uuid, documentId: uuid }),
});

export const updateVehicleDocumentSchema = z.object({
  params: z.object({ id: uuid, documentId: uuid }),
  body: z.object({
    issueDate: dateOnly.nullable().optional(),
    expiresAt: dateOnly.nullable().optional(),
  }).refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update.'),
});
