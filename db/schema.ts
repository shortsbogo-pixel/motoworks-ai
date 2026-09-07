import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const ts = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
};
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ...ts,
});
export const shops = sqliteTable(
  'shops',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    ...ts,
  },
  (t) => [uniqueIndex('shops_org_code_uq').on(t.organizationId, t.code)],
);
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    externalUserId: text('external_user_id').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    status: text('status', {
      enum: ['pending', 'active', 'suspended'],
    })
      .notNull()
      .default('pending'),
    passwordHash: text('password_hash'),
    passwordUpdatedAt: integer('password_updated_at', { mode: 'timestamp_ms' }),
    ...ts,
  },
  (t) => [uniqueIndex('users_external_uq').on(t.externalUserId)],
);

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  description: text('description'),
  permissionsJson: text('permissions_json').notNull(),
  ...ts,
});

export const userShopRoles = sqliteTable(
  'user_shop_roles',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    shopId: text('shop_id').references(() => shops.id),
    role: text('role', {
      enum: ['admin', 'shop_manager', 'staff', 'viewer', 'custom'],
    }).notNull(),
    roleId: text('role_id').references(() => roles.id),
    ...ts,
  },
  (t) => [
    index('roles_user_idx').on(t.userId),
    index('roles_shop_idx').on(t.shopId),
  ],
);

export const documentBatches = sqliteTable('document_batches', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  shopId: text('shop_id').references(() => shops.id),
  uploadedBy: text('uploaded_by')
    .notNull()
    .references(() => users.id),
  status: text('status', {
    enum: ['uploaded', 'processing', 'review', 'complete', 'failed'],
  }).notNull(),
  documentCount: integer('document_count').notNull().default(0),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  ...ts,
});
export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    shopId: text('shop_id').references(() => shops.id),
    batchId: text('batch_id')
      .notNull()
      .references(() => documentBatches.id),
    originalObjectKey: text('original_object_key').notNull(),
    processedObjectKey: text('processed_object_key'),
    originalFileName: text('original_file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sha256: text('sha256').notNull(),
    pageNumber: integer('page_number').notNull().default(1),
    sourceAvailable: integer('source_available', { mode: 'boolean' })
      .notNull()
      .default(true),
    ...ts,
  },
  (t) => [
    uniqueIndex('documents_org_hash_batch_uq').on(
      t.organizationId,
      t.sha256,
      t.batchId,
    ),
    index('documents_batch_idx').on(t.batchId),
  ],
);
export const extractionJobs = sqliteTable('extraction_jobs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  shopId: text('shop_id').references(() => shops.id),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id),
  provider: text('provider').notNull(),
  model: text('model'),
  mode: text('mode', { enum: ['live', 'mock'] }).notNull(),
  status: text('status', {
    enum: ['queued', 'running', 'succeeded', 'failed'],
  }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  ...ts,
});
export const extractedFields = sqliteTable(
  'extracted_fields',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    shopId: text('shop_id').references(() => shops.id),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id),
    jobId: text('job_id')
      .notNull()
      .references(() => extractionJobs.id),
    fieldKey: text('field_key').notNull(),
    rawValue: text('raw_value'),
    normalizedValue: text('normalized_value'),
    confidence: real('confidence').notNull(),
    boundingBoxJson: text('bounding_box_json').notNull(),
    validationStatus: text('validation_status', {
      enum: ['valid', 'review', 'conflict'],
    }).notNull(),
    validationMessage: text('validation_message'),
    correctedValue: text('corrected_value'),
    correctedBy: text('corrected_by').references(() => users.id),
    correctedAt: integer('corrected_at', { mode: 'timestamp_ms' }),
    ...ts,
  },
  (t) => [
    index('fields_document_idx').on(t.documentId),
    index('fields_review_idx').on(t.validationStatus),
  ],
);
export const reviewTasks = sqliteTable(
  'review_tasks',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    shopId: text('shop_id').references(() => shops.id),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id),
    status: text('status', {
      enum: ['pending', 'in_review', 'approved', 'rejected'],
    }).notNull(),
    reasonCodesJson: text('reason_codes_json').notNull(),
    assignedTo: text('assigned_to').references(() => users.id),
    decidedBy: text('decided_by').references(() => users.id),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
    decisionNote: text('decision_note'),
    ...ts,
  },
  (t) => [index('review_queue_idx').on(t.organizationId, t.shopId, t.status)],
);

export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    shopId: text('shop_id').references(() => shops.id),
    name: text('name').notNull(),
    phoneEncrypted: text('phone_encrypted'),
    phoneHash: text('phone_hash'),
    status: text('status', { enum: ['active', 'merged', 'inactive'] })
      .notNull()
      .default('active'),
    mergedIntoId: text('merged_into_id'),
    ...ts,
  },
  (t) => [index('customers_phone_hash_idx').on(t.organizationId, t.phoneHash)],
);
export const customerMergeCandidates = sqliteTable(
  'customer_merge_candidates',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    shopId: text('shop_id').references(() => shops.id),
    customerAId: text('customer_a_id')
      .notNull()
      .references(() => customers.id),
    customerBId: text('customer_b_id')
      .notNull()
      .references(() => customers.id),
    evidenceJson: text('evidence_json').notNull(),
    conflictJson: text('conflict_json'),
    score: real('score').notNull(),
    status: text('status', {
      enum: ['pending', 'approved', 'rejected', 'reversed'],
    }).notNull(),
    decidedBy: text('decided_by').references(() => users.id),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
    ...ts,
  },
);
export const vehicles = sqliteTable(
  'vehicles',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    shopId: text('shop_id').references(() => shops.id),
    customerId: text('customer_id').references(() => customers.id),
    plateEncrypted: text('plate_encrypted'),
    plateHash: text('plate_hash'),
    plateDigitsHash: text('plate_digits_hash'),
    manufacturer: text('manufacturer'),
    model: text('model'),
    displacementCc: integer('displacement_cc'),
    modelYear: integer('model_year'),
    certainty: text('certainty', {
      enum: ['confirmed', 'ai_estimated', 'unknown'],
    }).notNull(),
    ...ts,
  },
  (t) => [
    index('vehicles_plate_hash_idx').on(t.organizationId, t.plateHash),
    index('vehicles_plate_digits_idx').on(t.organizationId, t.plateDigitsHash),
  ],
);

export const securityRateLimits = sqliteTable('security_rate_limits', {
  key: text('key').primaryKey(),
  requestCount: integer('request_count').notNull().default(1),
  windowStart: integer('window_start').notNull(),
  consecutiveNoMatch: integer('consecutive_no_match').notNull().default(0),
  blockedUntil: integer('blocked_until').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});
export const serviceOrders = sqliteTable(
  'service_orders',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id),
    documentId: text('document_id').references(() => documents.id),
    customerId: text('customer_id').references(() => customers.id),
    vehicleId: text('vehicle_id').references(() => vehicles.id),
    originalDateValue: text('original_date_value'),
    normalizedDateCandidate: text('normalized_date_candidate'),
    dateConfidence: real('date_confidence'),
    dateChangeReason: text('date_change_reason'),
    approvedServiceDate: text('approved_service_date'),
    shopCertainty: text('shop_certainty', {
      enum: ['confirmed', 'ai_estimated', 'unknown'],
    }).notNull(),
    serviceType: text('service_type', {
      enum: ['personal', 'rental', 'lease'],
    }).notNull(),
    status: text('status', {
      enum: ['draft', 'review', 'approved', 'void'],
    }).notNull(),
    totalAmount: integer('total_amount').notNull().default(0),
    approvedBy: text('approved_by').references(() => users.id),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    ...ts,
  },
  (t) => [
    index('orders_shop_date_idx').on(
      t.organizationId,
      t.shopId,
      t.approvedServiceDate,
    ),
  ],
);
export const serviceItems = sqliteTable('service_items', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id),
  serviceOrderId: text('service_order_id')
    .notNull()
    .references(() => serviceOrders.id),
  rawName: text('raw_name'),
  normalizedName: text('normalized_name'),
  quantity: real('quantity').notNull().default(1),
  unitPrice: integer('unit_price').notNull().default(0),
  amount: integer('amount').notNull().default(0),
  ...ts,
});
export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id),
  serviceOrderId: text('service_order_id')
    .notNull()
    .references(() => serviceOrders.id),
  method: text('method', {
    enum: ['card', 'cash', 'transfer', 'rental_billing', 'other'],
  }).notNull(),
  amount: integer('amount').notNull(),
  paidAt: integer('paid_at', { mode: 'timestamp_ms' }),
  note: text('note'),
  ...ts,
});
export const rentalCompanies = sqliteTable('rental_companies', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  shopId: text('shop_id').references(() => shops.id),
  name: text('name').notNull(),
  billingContactEncrypted: text('billing_contact_encrypted'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  ...ts,
});
export const rentalContracts = sqliteTable('rental_contracts', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id),
  rentalCompanyId: text('rental_company_id')
    .notNull()
    .references(() => rentalCompanies.id),
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id),
  startsOn: text('starts_on'),
  endsOn: text('ends_on'),
  status: text('status', { enum: ['active', 'ended', 'paused'] }).notNull(),
  ...ts,
});
export const receivables = sqliteTable('receivables', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id),
  serviceOrderId: text('service_order_id')
    .notNull()
    .references(() => serviceOrders.id),
  rentalCompanyId: text('rental_company_id').references(
    () => rentalCompanies.id,
  ),
  basePrice: integer('base_price').notNull(),
  customerPaidAmount: integer('customer_paid_amount').notNull().default(0),
  billedAmount: integer('billed_amount').notNull().default(0),
  receivedAmount: integer('received_amount').notNull().default(0),
  outstandingAmount: integer('outstanding_amount').notNull().default(0),
  settlementStatus: text('settlement_status', {
    enum: ['unbilled', 'billed', 'partial', 'settled', 'disputed'],
  }).notNull(),
  ...ts,
});

export const vehicleTypeAliases = sqliteTable('vehicle_type_aliases', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  shopId: text('shop_id').references(() => shops.id),
  alias: text('alias').notNull(),
  manufacturer: text('manufacturer'),
  model: text('model'),
  displacementCc: integer('displacement_cc'),
  modelYear: integer('model_year'),
  autoConfirm: integer('auto_confirm', { mode: 'boolean' })
    .notNull()
    .default(false),
  correctionCount: integer('correction_count').notNull().default(0),
  ...ts,
});
export const serviceItemAliases = sqliteTable('service_item_aliases', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  shopId: text('shop_id').references(() => shops.id),
  alias: text('alias').notNull(),
  canonicalName: text('canonical_name').notNull(),
  correctionCount: integer('correction_count').notNull().default(0),
  ...ts,
});
export const priceRules = sqliteTable('price_rules', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  shopId: text('shop_id').references(() => shops.id),
  vehicleAliasId: text('vehicle_alias_id').references(
    () => vehicleTypeAliases.id,
  ),
  serviceAliasId: text('service_alias_id').references(
    () => serviceItemAliases.id,
  ),
  serviceType: text('service_type', { enum: ['personal', 'rental', 'lease'] }),
  price: integer('price').notNull(),
  activeFrom: text('active_from'),
  activeTo: text('active_to'),
  ...ts,
});
export const correctionLogs = sqliteTable('correction_logs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  shopId: text('shop_id').references(() => shops.id),
  documentId: text('document_id').references(() => documents.id),
  fieldKey: text('field_key').notNull(),
  rawValue: text('raw_value'),
  suggestedValue: text('suggested_value'),
  finalValue: text('final_value'),
  handwritingAuthorId: text('handwriting_author_id'),
  correctedBy: text('corrected_by')
    .notNull()
    .references(() => users.id),
  ...ts,
});
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    shopId: text('shop_id').references(() => shops.id),
    actorUserId: text('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('audit_entity_idx').on(t.organizationId, t.entityType, t.entityId),
    index('audit_actor_idx').on(t.actorUserId),
  ],
);
