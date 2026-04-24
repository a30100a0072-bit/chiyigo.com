-- Migration: requisition table — email→contact, service→service_type, description→message, add timeline
-- Run via: wrangler d1 execute chiyigo_db --file=database/migration_001_requisition_contact.sql

ALTER TABLE requisition RENAME COLUMN email       TO contact;
ALTER TABLE requisition RENAME COLUMN service     TO service_type;
ALTER TABLE requisition RENAME COLUMN description TO message;
ALTER TABLE requisition ADD COLUMN timeline TEXT;
