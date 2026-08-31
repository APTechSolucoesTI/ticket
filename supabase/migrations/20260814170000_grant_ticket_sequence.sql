-- tickets.number defaults to nextval('tickets_number_seq'), but the sequence
-- itself never got GRANTed to any role - only superuser could insert into
-- tickets. This silently broke ticket creation through every non-superuser
-- path: the client (authenticated), and server code running as service_role
-- (portal endpoints, WhatsApp/UAZAPI webhook, email channel).

GRANT USAGE, SELECT ON SEQUENCE public.tickets_number_seq TO authenticated, service_role;

-- Cover any future counter-style sequence in this schema the same way, so
-- this class of bug can't recur silently. (NOTE: literal schema name here,
-- not "public." - this statement form isn't dot-qualified so the apticket
-- migration-apply script's public.->apticket. rewrite won't touch it.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
