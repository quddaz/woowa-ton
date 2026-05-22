CREATE TABLE IF NOT EXISTS pr_summaries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pr_number BIGINT NOT NULL,
  pr_title VARCHAR(512) NULL,
  summary LONGTEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pr_summaries_pr_number (pr_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pr_important_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pr_number BIGINT NOT NULL,
  important_comments JSON NOT NULL,
  changes_requested_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pr_important_comments_pr_number (pr_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
