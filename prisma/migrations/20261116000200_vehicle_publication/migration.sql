ALTER TABLE `Vehicle`
  ADD COLUMN `isPublished` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `Vehicle_isPublished_status_archivedAt_idx`
  ON `Vehicle`(`isPublished`, `status`, `archivedAt`);
