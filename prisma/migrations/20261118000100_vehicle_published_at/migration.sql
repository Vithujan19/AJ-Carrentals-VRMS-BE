ALTER TABLE `Vehicle`
  ADD COLUMN `publishedAt` DATETIME(3) NULL;

UPDATE `Vehicle` SET `publishedAt` = `updatedAt` WHERE `isPublished` = true;
