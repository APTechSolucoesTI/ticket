-- Correção de cadastro solicitada para a APTech. Mantém os IDs, vínculos,
-- atributos de negócio e snapshots históricos; ajusta somente códigos atuais.
do $$
declare v_tenant uuid; item record; current_item apticket.financial_categories;
  root_item apticket.financial_categories;
begin
  select id into v_tenant from apticket.tenants where id='80e28baa-41d8-4a50-9fb1-f5d8ac51a93e' and slug='aptech-solucoes-ti';
  if not found then raise notice 'Correção de categorias não aplicável: organização APTech ausente.'; return; end if;
  lock table apticket.financial_categories in share row exclusive mode;

  -- Completa os níveis sintéticos que faltam, sem restaurar cadastros arquivados.
  for item in select * from (values
    ('02.01','Impostos e Taxas','Agrupamento de impostos, contribuições, taxas e parcelamentos tributários.'),
    ('03.01','Custos Operacionais','Agrupamento dos custos de estrutura e operação da empresa.'),
    ('04.01','Pessoal e Benefícios','Agrupamento dos custos de pessoal, remuneração e benefícios.')
  ) as subgroups(code,name,description) loop
    select * into root_item from apticket.financial_categories where tenant_id=v_tenant
      and code=left(item.code,2) and is_global and classification_type='synthetic' and deleted_at is null;
    if not found then raise exception 'Grupo sintético global % não encontrado.',left(item.code,2); end if;
    select * into current_item from apticket.financial_categories where tenant_id=v_tenant and code=item.code and deleted_at is null;
    if found then
      if current_item.classification_type<>'synthetic' or not current_item.is_global or not current_item.is_active then
        raise exception 'Subgrupo % já ocupado por cadastro incompatível.',item.code;
      end if;
    else
      insert into apticket.financial_categories(tenant_id,operating_company_id,code,name,description,direction,classification_type,is_global,is_active)
        values(v_tenant,root_item.operating_company_id,item.code,item.name,item.description,root_item.direction,'synthetic',true,true);
    end if;
  end loop;

  -- Mapeamento explícito e revisado: nenhuma renumeração genérica de registros.
  for item in select * from (values
    ('c7fb16e1-97e4-4bc0-9e6c-83f8275a1b73','02.02.0001','02.01.0001'),
    ('a960e27a-0786-47ba-83ba-e7325df2911c','02.02.0002','02.01.0002'),
    ('98a3236f-7c71-4f6a-9190-1a385edb7992','02.02.0003','02.01.0003'),
    ('ec316b56-267b-460e-80b7-7be184eb8ef1','02.02.0004','02.01.0004'),
    ('2752b6f5-12b9-4bb8-8ccf-ab2e27dcfbae','02.02.0005','02.01.0005'),
    ('120591e1-2eb3-4747-b0c8-ebff228c5497','02.02.0006','02.01.0006'),
    ('b5bbd3bb-598c-431c-aff5-a41ba01af28f','02.02.0007','02.01.0007'),
    ('7d81e114-b837-4f61-94ba-039daeb8919f','03.02.0002','03.01.0002'),
    ('b6b7e7de-9144-4279-a117-2773648a0e10','03.03.0003','03.01.0003'),
    ('ce1d115b-a271-495f-bff2-07c5dd38e4fc','03.04.0004','03.01.0004'),
    ('e8b44809-5675-4cf2-8613-90209de3300c','03.05.0005','03.01.0005'),
    ('60cba49e-37e5-4a63-88cc-ec19fce60276','03.06.0006','03.01.0006'),
    ('f9113b78-5a00-48ec-844b-7dd0889808c6','03.07.0007','03.01.0007'),
    ('98df2b82-4da9-4551-8e37-9be675fc6db1','03.08.0008','03.01.0008'),
    ('e19c91d6-1690-464f-8c97-605a9c935507','03.09.0009','03.01.0009'),
    ('46742008-baed-472d-8330-81ac4935374f','03.10.0010','03.01.0010'),
    ('f2a8abe2-4780-420c-968b-457e11eb210d','03.11.0011','03.01.0011'),
    ('033706d8-fa96-47c9-85cc-736b7cd47136','03.12.0012','03.01.0012'),
    ('f3be69d4-cbb3-46d0-9727-aa163a074456','03.13.0013','03.01.0013'),
    ('c37ea3c8-6c2a-400f-a440-d34aac137a0e','03.14.0014','03.01.0014'),
    ('06f02ac8-6f90-41dd-a572-934ed2be53c8','04.02.0002','04.01.0002'),
    ('2ad5a83b-54ff-4385-87ed-f1692d47897e','04.03.0003','04.01.0003'),
    ('75fa6407-1731-4f69-8b6b-b8743790a9dd','04.04.0004','04.01.0004'),
    ('1db9e0cd-7efb-47c1-bbfc-71e35537071a','04.05.0005','04.01.0005'),
    ('577c87c3-ac31-4d84-981b-fc43fd11a68f','04.06.0006','04.01.0006'),
    ('94f3d615-58ff-4452-a406-b2e020242b4b','04.07.0007','04.01.0007'),
    ('6e18c670-df1b-4587-a04b-2b4ddbdfb187','04.08.0008','04.01.0008'),
    ('3606083a-51a9-4c82-b044-e3e7bed09d31','04.09.0009','04.01.0009'),
    ('885112bf-a243-4cfc-9d92-5fd498af53cf','04.10.0010','04.01.0010'),
    ('a2bacd80-392e-40b4-bf6f-46be2189ea9d','04.11.0011','04.01.0011'),
    ('8ad2cf68-3067-4f40-9831-7a68a511d9ff','04.12.0012','04.01.0012'),
    ('87e8dd7d-09cb-4280-bfe3-0c3946cf282b','04.13.0013','04.01.0013'),
    ('5193dd3f-54ef-4a07-b56a-8f5d11725233','04.14.0014','04.01.0014'),
    ('ad0efa82-0981-453d-9b4d-3a6bf1f9f8d0','04.15.0015','04.01.0015'),
    ('13ab0af6-a14e-4260-90ef-34652f12a5f9','04.16.0016','04.01.0016'),
    ('7828d21a-05cd-4dfb-ba98-0af95ba01ab3','04.17.0017','04.01.0017'),
    ('1a3a0dd9-be63-4219-94a8-ebc88fb386d3','04.18.0018','04.01.0018')
  ) as mapping(id,old_code,new_code) loop
    select * into current_item from apticket.financial_categories
      where id=item.id::uuid and tenant_id=v_tenant and deleted_at is null;
    if not found then raise exception 'Categoria % ausente ou arquivada; correção interrompida.',item.id; end if;
    if current_item.code=item.new_code then continue; end if;
    if current_item.code<>item.old_code or current_item.classification_type<>'analytic' then
      raise exception 'Categoria % mudou desde a conferência; código atual: %.',item.id,current_item.code;
    end if;
    if exists(select 1 from apticket.financial_categories other where other.tenant_id=v_tenant and other.id<>current_item.id
      and other.deleted_at is null and other.code=item.new_code
      and (other.is_global or current_item.is_global or other.operating_company_id=current_item.operating_company_id)) then
      raise exception 'Código de destino % já utilizado; nenhuma alteração será mantida.',item.new_code;
    end if;
    update apticket.financial_categories set code=item.new_code,updated_at=clock_timestamp(),updated_by=null where id=current_item.id;
  end loop;
end $$;
