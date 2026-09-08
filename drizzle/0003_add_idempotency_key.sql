ALTER TABLE `service_orders` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_service_orders_idem` ON `service_orders` (`shop_id`, `idempotency_key`);
