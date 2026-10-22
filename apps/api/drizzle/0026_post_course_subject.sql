-- Posts now name the course with the task, "RSM222 · Assignment" (2026-10-22). Posts made
-- before keep the task title they were shared with and get their root course in front.
WITH RECURSIVE up AS (
  SELECT p.id AS post_id, n.parent_id, 0 AS depth, n.title AS root_title
  FROM posts p
  JOIN sessions s ON s.id = p.session_id
  JOIN nodes n ON n.id = s.node_id
  WHERE p.subject IS NOT NULL AND n.parent_id IS NOT NULL
  UNION ALL
  SELECT up.post_id, n.parent_id, up.depth + 1, n.title
  FROM up
  JOIN nodes n ON n.id = up.parent_id
  WHERE up.depth < 32
)
UPDATE posts
SET subject = up.root_title || ' · ' || posts.subject
FROM up
WHERE up.post_id = posts.id AND up.parent_id IS NULL;
