-- A loop's single context note becomes a checklist it can hold several of.
-- The order of the array is the user's own; the first unchecked item is the
-- line the row marquee reads. The old `note` column stays as a derived cache
-- of that line, so older action_history snapshots still restore cleanly.

ALTER TABLE loops ADD COLUMN notes jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(notes) = 'array');

-- Every existing note becomes the first (unchecked) line of its loop's list.
UPDATE loops
   SET notes = jsonb_build_array(
     jsonb_build_object('id', md5(random()::text || id::text), 'text', note, 'done', false)
   )
 WHERE note <> '';
