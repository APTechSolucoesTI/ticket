-- Carga de dados solicitada para a organização APTech. Não altera cadastros
-- existentes nem popula outras organizações. Globais são compartilhados pelas
-- operadoras da mesma tenant, mantendo o isolamento já existente por RLS.
do $$
declare
  v_tenant uuid; v_company uuid; item record; current_item apticket.financial_cost_centers;
begin
  select id into v_tenant from apticket.tenants
    where id='80e28baa-41d8-4a50-9fb1-f5d8ac51a93e' and slug='aptech-solucoes-ti';
  if not found then
    raise notice 'Carga de centros MSP não aplicável: organização APTech ausente.';
    return;
  end if;
  select id into v_company from apticket.operating_companies
    where id='c49035d7-b1a0-4677-a602-f5dbeca6b7fc' and tenant_id=v_tenant
      and is_active and deleted_at is null;
  if not found then raise exception 'Empresa operadora APTech ativa não encontrada para a carga de centros MSP.'; end if;
  lock table apticket.financial_cost_centers in share row exclusive mode;
  for item in select * from (values
    ('01','Operações MSP','synthetic','Operação e entrega contínua dos serviços gerenciados.'),
    ('01.01','Atendimento e suporte','synthetic','Equipes responsáveis pelo atendimento e resolução de solicitações e incidentes.'),
    ('01.01.0001','Service Desk N1','analytic','Central de atendimento, triagem e suporte de primeiro nível.'),
    ('01.01.0002','Suporte N2','analytic','Equipe de suporte técnico especializado de segundo nível.'),
    ('01.01.0003','Suporte N3 e especialistas','analytic','Especialistas responsáveis por incidentes complexos e escalonamentos técnicos.'),
    ('01.01.0004','Suporte de campo — Field Service','analytic','Equipe de atendimento presencial e assistência técnica nas instalações dos clientes.'),
    ('01.02','Operações e monitoramento','synthetic','Equipes de operação proativa, automação e gestão dos serviços.'),
    ('01.02.0001','NOC e monitoramento','analytic','Centro de operações e monitoramento proativo da disponibilidade e do desempenho.'),
    ('01.02.0002','Automação e gestão RMM','analytic','Equipe responsável por automação operacional e gestão remota dos ambientes dos clientes.'),
    ('01.02.0003','Gestão de serviços — ITSM','analytic','Gestão da entrega, níveis de serviço, mudanças, problemas e processos operacionais.'),
    ('02','Infraestrutura e Nuvem','synthetic','Equipes de infraestrutura, conectividade, nuvem e continuidade dos ambientes.'),
    ('02.01','Infraestrutura e conectividade','synthetic','Gestão técnica de servidores, virtualização e redes.'),
    ('02.01.0001','Servidores e virtualização','analytic','Equipe responsável pela administração de servidores, plataformas e ambientes virtualizados.'),
    ('02.01.0002','Redes e conectividade','analytic','Equipe responsável por redes locais, conectividade, comunicação e infraestrutura de rede.'),
    ('02.02','Nuvem e continuidade','synthetic','Operação de plataformas em nuvem, colaboração e recuperação dos serviços.'),
    ('02.02.0001','Serviços de nuvem e hosting','analytic','Equipe responsável por operação e sustentação de ambientes em nuvem e hospedagem.'),
    ('02.02.0002','Backup e recuperação de desastres','analytic','Equipe responsável por cópias de segurança, restauração e continuidade operacional.'),
    ('02.02.0003','Microsoft 365 e colaboração','analytic','Equipe responsável por Microsoft 365, identidade e plataformas de produtividade dos clientes.'),
    ('03','Segurança da Informação','synthetic','Operações de segurança gerenciada, governança e conformidade.'),
    ('03.01','Operações de segurança','synthetic','Equipes de detecção, proteção e resposta a ameaças.'),
    ('03.01.0001','SOC e resposta a incidentes','analytic','Centro de operações de segurança, investigação e resposta a incidentes.'),
    ('03.01.0002','Segurança gerenciada e proteção de endpoints','analytic','Equipe responsável pela sustentação dos controles e soluções de proteção dos clientes.'),
    ('03.02','Governança e conformidade','synthetic','Gestão de riscos, políticas e requisitos de segurança da informação.'),
    ('03.02.0001','Governança, riscos e conformidade','analytic','Equipe responsável por avaliação de riscos, políticas, privacidade e conformidade.'),
    ('04','Projetos e Consultoria','synthetic','Entregas técnicas por projeto e serviços de consultoria.'),
    ('04.01','Projetos técnicos','synthetic','Equipes de implantação, migração, desenho e evolução de soluções.'),
    ('04.01.0001','Implantação e migração','analytic','Equipe responsável pela execução de projetos de implantação e migração dos clientes.'),
    ('04.01.0002','Consultoria e arquitetura de soluções','analytic','Equipe responsável por diagnósticos, planejamento técnico e arquitetura de soluções.'),
    ('05','Relacionamento e Comercial','synthetic','Relacionamento com clientes, desenvolvimento de negócios e posicionamento comercial.'),
    ('05.01','Clientes e vendas','synthetic','Equipes responsáveis pela jornada do cliente e pelo desenvolvimento comercial.'),
    ('05.01.0001','Gestão de contas e sucesso do cliente','analytic','Equipe responsável por relacionamento, acompanhamento dos contratos e sucesso do cliente.'),
    ('05.01.0002','Vendas e pré-vendas','analytic','Equipe responsável pela prospecção, desenho de propostas e fechamento de negócios.'),
    ('05.01.0003','Marketing','analytic','Equipe responsável por comunicação, posicionamento e geração de oportunidades.'),
    ('06','Administração e Pessoas','synthetic','Áreas administrativas, financeiras, de pessoas e de direção.'),
    ('06.01','Gestão administrativa','synthetic','Estrutura de apoio administrativo e de gestão da empresa.'),
    ('06.01.0001','Financeiro e controladoria','analytic','Equipe responsável por tesouraria, cobrança, planejamento financeiro e controladoria.'),
    ('06.01.0002','Administrativo e contabilidade','analytic','Equipe responsável pela administração geral e pela coordenação contábil e fiscal.'),
    ('06.01.0003','Recursos humanos e departamento pessoal','analytic','Equipe responsável por recrutamento, gestão de pessoas e rotinas de departamento pessoal.'),
    ('06.01.0004','Diretoria e gestão','analytic','Estrutura de direção, planejamento estratégico e gestão corporativa.'),
    ('07','Tecnologia e Desenvolvimento','synthetic','Tecnologia interna, desenvolvimento e evolução das soluções da empresa.'),
    ('07.01','Sistemas e inovação','synthetic','Equipes de sustentação interna, desenvolvimento e pesquisa de soluções.'),
    ('07.01.0001','TI interna e sistemas corporativos','analytic','Equipe responsável pela tecnologia de uso interno e pelos sistemas corporativos do MSP.'),
    ('07.01.0002','Desenvolvimento e integrações','analytic','Equipe responsável por sistemas, integrações e desenvolvimento de soluções próprias.'),
    ('07.01.0003','Pesquisa e inovação','analytic','Equipe responsável por avaliação de tecnologias e evolução das soluções e serviços.')
  ) as catalog(code,name,classification_type,description) loop
    select * into current_item from apticket.financial_cost_centers
      where tenant_id=v_tenant and deleted_at is null and lower(code)=lower(item.code) limit 1;
    if found then
      if current_item.name is distinct from item.name
        or current_item.classification_type is distinct from item.classification_type
        or not current_item.is_global or not current_item.is_active then
        raise exception 'Código de centro de custo % já utilizado por outro cadastro; carga interrompida sem sobrescrever dados.',item.code;
      end if;
      continue;
    end if;
    insert into apticket.financial_cost_centers(tenant_id,operating_company_id,code,name,description,classification_type,is_global,is_active)
      values(v_tenant,v_company,item.code,item.name,item.description,item.classification_type,true,true);
  end loop;
end $$;
