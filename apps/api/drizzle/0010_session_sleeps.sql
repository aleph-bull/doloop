ALTER TABLE "sessions" ADD COLUMN "sleeps" jsonb DEFAULT '[]'::jsonb NOT NULL;
