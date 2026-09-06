CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`ip_hash` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`organization_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_logs` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `correction_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`document_id` text,
	`field_key` text NOT NULL,
	`raw_value` text,
	`suggested_value` text,
	`final_value` text,
	`handwriting_author_id` text,
	`corrected_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`corrected_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customer_merge_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`customer_a_id` text NOT NULL,
	`customer_b_id` text NOT NULL,
	`evidence_json` text NOT NULL,
	`conflict_json` text,
	`score` real NOT NULL,
	`status` text NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_a_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_b_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`name` text NOT NULL,
	`phone_encrypted` text,
	`phone_hash` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `customers_phone_hash_idx` ON `customers` (`organization_id`,`phone_hash`);--> statement-breakpoint
CREATE TABLE `document_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`uploaded_by` text NOT NULL,
	`status` text NOT NULL,
	`document_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`batch_id` text NOT NULL,
	`original_object_key` text NOT NULL,
	`processed_object_key` text,
	`original_file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`sha256` text NOT NULL,
	`page_number` integer DEFAULT 1 NOT NULL,
	`source_available` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `document_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_org_hash_batch_uq` ON `documents` (`organization_id`,`sha256`,`batch_id`);--> statement-breakpoint
CREATE INDEX `documents_batch_idx` ON `documents` (`batch_id`);--> statement-breakpoint
CREATE TABLE `extracted_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`document_id` text NOT NULL,
	`job_id` text NOT NULL,
	`field_key` text NOT NULL,
	`raw_value` text,
	`normalized_value` text,
	`confidence` real NOT NULL,
	`bounding_box_json` text NOT NULL,
	`validation_status` text NOT NULL,
	`validation_message` text,
	`corrected_value` text,
	`corrected_by` text,
	`corrected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `extraction_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`corrected_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fields_document_idx` ON `extracted_fields` (`document_id`);--> statement-breakpoint
CREATE INDEX `fields_review_idx` ON `extracted_fields` (`validation_status`);--> statement-breakpoint
CREATE TABLE `extraction_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`document_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text NOT NULL,
	`service_order_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`paid_at` integer,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_order_id`) REFERENCES `service_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `price_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`vehicle_alias_id` text,
	`service_alias_id` text,
	`service_type` text,
	`price` integer NOT NULL,
	`active_from` text,
	`active_to` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vehicle_alias_id`) REFERENCES `vehicle_type_aliases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_alias_id`) REFERENCES `service_item_aliases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `receivables` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text NOT NULL,
	`service_order_id` text NOT NULL,
	`rental_company_id` text,
	`base_price` integer NOT NULL,
	`customer_paid_amount` integer DEFAULT 0 NOT NULL,
	`billed_amount` integer DEFAULT 0 NOT NULL,
	`received_amount` integer DEFAULT 0 NOT NULL,
	`outstanding_amount` integer DEFAULT 0 NOT NULL,
	`settlement_status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_order_id`) REFERENCES `service_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rental_company_id`) REFERENCES `rental_companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rental_companies` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`name` text NOT NULL,
	`billing_contact_encrypted` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rental_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text NOT NULL,
	`rental_company_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rental_company_id`) REFERENCES `rental_companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `review_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`document_id` text NOT NULL,
	`status` text NOT NULL,
	`reason_codes_json` text NOT NULL,
	`assigned_to` text,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_queue_idx` ON `review_tasks` (`organization_id`,`shop_id`,`status`);--> statement-breakpoint
CREATE TABLE `service_item_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`alias` text NOT NULL,
	`canonical_name` text NOT NULL,
	`correction_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `service_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text NOT NULL,
	`service_order_id` text NOT NULL,
	`raw_name` text,
	`normalized_name` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_order_id`) REFERENCES `service_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `service_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text NOT NULL,
	`document_id` text,
	`customer_id` text,
	`vehicle_id` text,
	`original_date_value` text,
	`normalized_date_candidate` text,
	`date_confidence` real,
	`date_change_reason` text,
	`approved_service_date` text,
	`shop_certainty` text NOT NULL,
	`service_type` text NOT NULL,
	`status` text NOT NULL,
	`total_amount` integer DEFAULT 0 NOT NULL,
	`approved_by` text,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `orders_shop_date_idx` ON `service_orders` (`organization_id`,`shop_id`,`approved_service_date`);--> statement-breakpoint
CREATE TABLE `shops` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shops_org_code_uq` ON `shops` (`organization_id`,`code`);--> statement-breakpoint
CREATE TABLE `user_shop_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`shop_id` text,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `roles_user_idx` ON `user_shop_roles` (`user_id`);--> statement-breakpoint
CREATE INDEX `roles_shop_idx` ON `user_shop_roles` (`shop_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`external_user_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_external_uq` ON `users` (`external_user_id`);--> statement-breakpoint
CREATE TABLE `vehicle_type_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`alias` text NOT NULL,
	`manufacturer` text,
	`model` text,
	`displacement_cc` integer,
	`model_year` integer,
	`auto_confirm` integer DEFAULT false NOT NULL,
	`correction_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text,
	`customer_id` text,
	`plate_encrypted` text,
	`plate_hash` text,
	`manufacturer` text,
	`model` text,
	`displacement_cc` integer,
	`model_year` integer,
	`certainty` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `vehicles_plate_hash_idx` ON `vehicles` (`organization_id`,`plate_hash`);