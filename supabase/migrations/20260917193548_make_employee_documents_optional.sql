-- Documentos de funcionários são opcionais. Mantemos a coluna por
-- compatibilidade com clientes e integrações existentes, mas impedimos que
-- novos tipos voltem a ser marcados como obrigatórios.
update apticket.funcionario_tipos_documento
set obrigatorio = false
where obrigatorio;

alter table apticket.funcionario_tipos_documento
  alter column obrigatorio set default false,
  add constraint funcionario_tipos_documento_never_required
    check (not obrigatorio);

notify pgrst, 'reload schema';
