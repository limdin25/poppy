-- Strict A/B voice alternation for inbound calls.
--
-- Used by the Retell inbound webhook (api/webhooks/retell-inbound.ts): on every
-- inbound call Retell asks which agent should answer, and we return the next
-- voice in turn. The "turn" is an atomic counter on the channel so that even
-- simultaneous calls get consecutive values => clean one-each alternation with
-- no race (unlike flipping the live phone routing after each call, which jammed).
--
-- The channel's config holds:
--   config.ab_agents  : jsonb array of Retell agent ids to rotate through
--   config.ab_counter : integer, incremented atomically by this function
--
-- Returns the chosen Retell agent id, or NULL when the channel has no A/B setup
-- (the webhook then lets Retell fall back to the number's default agent).

create or replace function ab_pick_agent(p_to text)
returns text
language plpgsql
as $$
declare
  v_agents jsonb;
  v_count  int;
  v_len    int;
begin
  update channels
     set config = jsonb_set(config, '{ab_counter}',
                            to_jsonb(coalesce((config->>'ab_counter')::int, 0) + 1))
   where type = 'voice'
     and config->>'phone' = p_to
     and (config ? 'ab_agents')
   returning config->'ab_agents', (config->>'ab_counter')::int
        into v_agents, v_count;

  if v_agents is null then return null; end if;
  v_len := jsonb_array_length(v_agents);
  if coalesce(v_len, 0) = 0 then return null; end if;
  return v_agents->> ((v_count - 1) % v_len);
end;
$$;

grant execute on function ab_pick_agent(text) to service_role;
