ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");
--> statement-breakpoint
-- Every account gets a username now: two random words ("quiet.otter"), the same lists as
-- core's USERNAME_WORDS. A pair already taken is tried again; after 8 tries a third word
-- follows. username_changed_at stays null, so the first change is free.
DO $$
DECLARE
  adjectives text[] := ARRAY[
    'amber', 'bold', 'brave', 'breezy', 'bright', 'brisk', 'calm', 'candid', 'chill', 'clever',
    'cosy', 'crisp', 'curious', 'dapper', 'dreamy', 'eager', 'early', 'fancy', 'fluffy',
    'frosty', 'gentle', 'glad', 'golden', 'grand', 'happy', 'hazy', 'honest', 'hopeful',
    'humble', 'jolly', 'keen', 'kind', 'lively', 'lucky', 'mellow', 'merry', 'mighty', 'misty',
    'nimble', 'noble', 'patient', 'peachy', 'plucky', 'polite', 'proud', 'quick', 'quiet',
    'rosy', 'rustic', 'snowy', 'spry', 'steady', 'sunny', 'swift', 'tidy', 'tiny', 'velvet',
    'vivid', 'warm', 'wild', 'wise', 'witty', 'zany', 'zesty'
  ];
  nouns text[] := ARRAY[
    'acorn', 'badger', 'beaver', 'birch', 'bison', 'cedar', 'clover', 'comet', 'coral',
    'crane', 'cricket', 'dove', 'eagle', 'falcon', 'fern', 'finch', 'fox', 'gecko', 'hare',
    'hazel', 'heron', 'ibis', 'kiwi', 'koala', 'lark', 'lemur', 'lily', 'lynx', 'maple',
    'meadow', 'moose', 'moth', 'newt', 'oak', 'orca', 'otter', 'owl', 'panda', 'pebble',
    'pine', 'plum', 'puffin', 'quail', 'quokka', 'raven', 'reef', 'river', 'robin', 'seal',
    'sparrow', 'squirrel', 'stork', 'swan', 'thistle', 'tiger', 'toucan', 'tulip', 'walrus',
    'willow', 'wombat', 'wren', 'yak', 'zebra', 'zinnia'
  ];
  person record;
  candidate text;
  tries int;
BEGIN
  FOR person IN SELECT id FROM users WHERE username IS NULL ORDER BY created_at LOOP
    tries := 0;
    LOOP
      candidate := adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
        || '.' || nouns[1 + floor(random() * array_length(nouns, 1))::int];
      IF tries >= 8 THEN
        candidate := candidate || '.' || nouns[1 + floor(random() * array_length(nouns, 1))::int];
      END IF;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE username = candidate);
      tries := tries + 1;
    END LOOP;
    UPDATE users SET username = candidate WHERE id = person.id;
  END LOOP;
END $$;
