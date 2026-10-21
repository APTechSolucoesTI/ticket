-- Reopens direct credential reads/writes; coordinate application rollback.
do $$
declare item record;
begin
  for item in select table_name, grantee, privilege_type, string_agg(quote_ident(column_name),',') cols
    from apticket_security_private.integration_acl_snapshot group by table_name,grantee,privilege_type loop
    execute format('grant %s (%s) on apticket.%I to %s', item.privilege_type,item.cols,item.table_name,
      case when item.grantee='PUBLIC' then 'public' else quote_ident(item.grantee) end);
  end loop;
end;
$$;
drop table apticket_security_private.integration_acl_snapshot;
notify pgrst, 'reload schema';
