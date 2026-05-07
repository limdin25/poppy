-- Analytics RPC functions for dashboard aggregations

-- Daily volume of messages + calls
CREATE OR REPLACE FUNCTION analytics_volume(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE(day date, messages_in bigint, messages_out bigint, calls bigint) AS $$
BEGIN
  RETURN QUERY
  WITH msg_counts AS (
    SELECT
      (m.created_at AT TIME ZONE COALESCE(b.timezone, 'Europe/London'))::date AS d,
      count(*) FILTER (WHERE m.direction = 'inbound') AS m_in,
      count(*) FILTER (WHERE m.direction = 'outbound') AS m_out
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN businesses b ON b.id = c.business_id
    WHERE c.business_id = p_business_id
      AND m.created_at BETWEEN p_from AND p_to
      AND (p_channel IS NULL OR c.channel = p_channel)
    GROUP BY d
  ),
  call_counts AS (
    SELECT
      (cl.created_at AT TIME ZONE COALESCE(b.timezone, 'Europe/London'))::date AS d,
      count(*) AS c
    FROM calls cl
    JOIN businesses b ON b.id = cl.business_id
    WHERE cl.business_id = p_business_id
      AND cl.created_at BETWEEN p_from AND p_to
      AND (p_channel IS NULL OR p_channel = 'voice')
    GROUP BY d
  ),
  all_days AS (
    SELECT d FROM msg_counts
    UNION
    SELECT d FROM call_counts
  )
  SELECT
    ad.d AS day,
    COALESCE(mc.m_in, 0) AS messages_in,
    COALESCE(mc.m_out, 0) AS messages_out,
    COALESCE(cc.c, 0) AS calls
  FROM all_days ad
  LEFT JOIN msg_counts mc ON mc.d = ad.d
  LEFT JOIN call_counts cc ON cc.d = ad.d
  ORDER BY ad.d;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- AI performance breakdown
CREATE OR REPLACE FUNCTION analytics_ai_performance(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE(auto_sent bigint, drafted bigint, human_sent bigint, total bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE m.sender = 'ai' AND m.status IS DISTINCT FROM 'draft') AS auto_sent,
    count(*) FILTER (WHERE m.sender = 'ai' AND m.status = 'draft') AS drafted,
    count(*) FILTER (WHERE m.sender = 'human') AS human_sent,
    count(*) AS total
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.business_id = p_business_id
    AND m.direction = 'outbound'
    AND m.created_at BETWEEN p_from AND p_to;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Busiest hours heatmap (day_of_week 0=Sun, hour 0-23)
CREATE OR REPLACE FUNCTION analytics_busiest_hours(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE(day_of_week int, hour int, count bigint) AS $$
BEGIN
  RETURN QUERY
  WITH all_activity AS (
    SELECT m.created_at AT TIME ZONE COALESCE(b.timezone, 'Europe/London') AS local_ts
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN businesses b ON b.id = c.business_id
    WHERE c.business_id = p_business_id
      AND m.direction = 'inbound'
      AND m.created_at BETWEEN p_from AND p_to
    UNION ALL
    SELECT cl.created_at AT TIME ZONE COALESCE(b.timezone, 'Europe/London') AS local_ts
    FROM calls cl
    JOIN businesses b ON b.id = cl.business_id
    WHERE cl.business_id = p_business_id
      AND cl.created_at BETWEEN p_from AND p_to
  )
  SELECT
    EXTRACT(DOW FROM local_ts)::int AS day_of_week,
    EXTRACT(HOUR FROM local_ts)::int AS hour,
    count(*) AS count
  FROM all_activity
  GROUP BY 1, 2
  ORDER BY 1, 2;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Contact growth (daily new + cumulative)
CREATE OR REPLACE FUNCTION analytics_contact_growth(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE(day date, new_contacts bigint, cumulative bigint) AS $$
BEGIN
  RETURN QUERY
  WITH daily AS (
    SELECT
      (created_at AT TIME ZONE 'Europe/London')::date AS d,
      count(*) AS n
    FROM contacts
    WHERE business_id = p_business_id
      AND created_at BETWEEN p_from AND p_to
    GROUP BY d
  ),
  total_before AS (
    SELECT count(*) AS n
    FROM contacts
    WHERE business_id = p_business_id
      AND created_at < p_from
  )
  SELECT
    daily.d AS day,
    daily.n AS new_contacts,
    (SELECT tb.n FROM total_before tb) + SUM(daily.n) OVER (ORDER BY daily.d) AS cumulative
  FROM daily
  ORDER BY daily.d;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Average response time in seconds (inbound → first outbound reply)
CREATE OR REPLACE FUNCTION analytics_avg_response_time(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE(avg_seconds numeric, median_seconds numeric, total_pairs bigint) AS $$
BEGIN
  RETURN QUERY
  WITH inbound_msgs AS (
    SELECT m.id, m.conversation_id, m.created_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.business_id = p_business_id
      AND m.direction = 'inbound'
      AND m.created_at BETWEEN p_from AND p_to
  ),
  first_reply AS (
    SELECT DISTINCT ON (im.id)
      im.id AS inbound_id,
      EXTRACT(EPOCH FROM (reply.created_at - im.created_at)) AS delta
    FROM inbound_msgs im
    JOIN messages reply ON reply.conversation_id = im.conversation_id
      AND reply.direction = 'outbound'
      AND reply.created_at > im.created_at
      AND reply.created_at < im.created_at + interval '24 hours'
    ORDER BY im.id, reply.created_at
  )
  SELECT
    round(avg(delta)::numeric, 0) AS avg_seconds,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY delta)::numeric, 0) AS median_seconds,
    count(*) AS total_pairs
  FROM first_reply
  WHERE delta > 0 AND delta < 86400;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Summary metrics (appointments, quotes, invoices)
CREATE OR REPLACE FUNCTION analytics_business_summary(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE(
  appointments_total bigint,
  appointments_confirmed bigint,
  appointments_cancelled bigint,
  appointments_no_show bigint,
  appointments_completed bigint,
  quotes_total bigint,
  quotes_sent bigint,
  quotes_accepted bigint,
  quotes_value numeric,
  quotes_accepted_value numeric,
  invoices_total bigint,
  invoices_paid bigint,
  invoices_overdue bigint,
  invoices_total_value numeric,
  invoices_paid_value numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM appointments WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to),
    (SELECT count(*) FROM appointments WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to AND status = 'confirmed'),
    (SELECT count(*) FROM appointments WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to AND status = 'cancelled'),
    (SELECT count(*) FROM appointments WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to AND status = 'no_show'),
    (SELECT count(*) FROM appointments WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to AND status = 'completed'),
    (SELECT count(*) FROM quotes WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to),
    (SELECT count(*) FROM quotes WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to AND status IN ('sent', 'accepted', 'rejected', 'expired')),
    (SELECT count(*) FROM quotes WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to AND status = 'accepted'),
    COALESCE((SELECT sum(total) FROM quotes WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to), 0),
    COALESCE((SELECT sum(total) FROM quotes WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to AND status = 'accepted'), 0),
    (SELECT count(*) FROM invoices WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to),
    (SELECT count(*) FROM invoices WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to AND status = 'paid'),
    (SELECT count(*) FROM invoices WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to AND status = 'overdue'),
    COALESCE((SELECT sum(total) FROM invoices WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to), 0),
    COALESCE((SELECT sum(total) FROM invoices WHERE business_id = p_business_id AND created_at BETWEEN p_from AND p_to AND status = 'paid'), 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Performance index on messages for analytics queries
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_created_direction
  ON messages(created_at, direction);

CREATE INDEX IF NOT EXISTS idx_calls_business_created
  ON calls(business_id, created_at);

CREATE INDEX IF NOT EXISTS idx_contacts_business_created
  ON contacts(business_id, created_at);

CREATE INDEX IF NOT EXISTS idx_appointments_business_created
  ON appointments(business_id, created_at);
