// Fonte real agora é packages/shared-types/src/database.ts — movido pra lá
// pra apps/api também tipar o client Supabase com o schema `apticket` real,
// em vez de reescrever/duplicar esse arquivo (1800+ linhas geradas). Esse
// arquivo continua existindo só pra não quebrar todo import existente
// (`@/integrations/supabase/types`) espalhado pelo apps/web.
export * from "@apticket/shared-types/database";
