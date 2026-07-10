-- Viewport x theme completeness matrix for the screenshot-table gate (#4540). The gate (#2006) only proves
-- "some markdown table with some image exists"; the documented contributor contract for visual PRs is an
-- exact viewport x theme x before/after matrix (e.g. 3 viewports x 2 themes = 12 images), and partial
-- submissions currently read as compliant. These two JSON string-array columns are the opt-in requirement
-- lists: empty (the default) is byte-identical to today's behavior; when require_viewports is non-empty, each
-- (viewport, theme) pair must appear as a labeled, image-bearing table row. Stored as JSON arrays mirroring
-- screenshot_table_gate_when_labels_json / when_paths_json in this same table. No new action column: the
-- existing screenshot_table_gate_action TEXT column now also admits 'advisory' app-side (validated in
-- review/screenshot-table-gate.ts), which computes/report the violation without contributing to the
-- close-triggering match.
ALTER TABLE repository_settings ADD COLUMN screenshot_table_gate_require_viewports_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE repository_settings ADD COLUMN screenshot_table_gate_require_themes_json TEXT NOT NULL DEFAULT '[]';
