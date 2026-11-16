-- The backend may inspect provider state to reuse a still-valid provider input.
-- Provider mutations remain restricted to service-only lifecycle RPCs.
grant select on public.private_live_provider_state to service_role;
