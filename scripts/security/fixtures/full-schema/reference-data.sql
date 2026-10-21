insert into apticket.feriados (tenant_id, data, nome, abrangencia)
select null, make_date(ano, mes, dia), nome, 'nacional'
from generate_series(2020, 2040) as ano
cross join (
  values
    (1, 1, 'Confraternização Universal'),
    (4, 21, 'Tiradentes'),
    (5, 1, 'Dia Mundial do Trabalho'),
    (9, 7, 'Independência do Brasil'),
    (10, 12, 'Nossa Senhora Aparecida'),
    (11, 2, 'Finados'),
    (11, 15, 'Proclamação da República'),
    (11, 20, 'Dia Nacional de Zumbi e da Consciência Negra'),
    (12, 25, 'Natal')
) as fixo(mes, dia, nome)
on conflict do nothing;

insert into apticket.feriados (tenant_id, data, nome, abrangencia)
select null, apticket.data_pascoa(ano) + deslocamento, nome, 'nacional'
from generate_series(2020, 2040) as ano
cross join (
  values
    (-48, 'Carnaval'),
    (-47, 'Carnaval'),
    (-2, 'Paixão de Cristo'),
    (60, 'Corpus Christi')
) as movel(deslocamento, nome)
on conflict do nothing;


-- Registered but never executed in the network-isolated audit database.
select cron.schedule('apticket-fixed-payable-forecasts','20 6 * * *','select apticket_finance_private.maintain_fixed_payable_forecasts();');
