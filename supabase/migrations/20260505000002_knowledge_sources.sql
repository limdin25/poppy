-- Knowledge sources for training the AI
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('website', 'document')),
  url text,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'synced', 'failed')),
  content text,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_business ON knowledge_sources(business_id);

ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own business sources"
  ON knowledge_sources FOR SELECT
  USING (business_id IN (SELECT business_id FROM team_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own business sources"
  ON knowledge_sources FOR INSERT
  WITH CHECK (business_id IN (SELECT business_id FROM team_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own business sources"
  ON knowledge_sources FOR DELETE
  USING (business_id IN (SELECT business_id FROM team_members WHERE user_id = auth.uid()));
