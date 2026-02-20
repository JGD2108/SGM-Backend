INSERT INTO "DocumentType" ("id", "key", "name", "required", "isActive")
VALUES ('seed_document_type_otro', 'OTRO', 'Otro', false, true)
ON CONFLICT ("key") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "required" = EXCLUDED."required",
  "isActive" = true;
