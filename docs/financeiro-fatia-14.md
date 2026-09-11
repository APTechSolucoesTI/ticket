# Financeiro: régua de cobrança e suspensão desacoplada

## Escopo

A régua é configurada por empresa operadora dentro da tenant. Cada etapa define
o deslocamento em dias em relação ao vencimento, o canal e o texto que será
congelado na ação de cobrança.

Esta fatia entrega a preparação controlada: a régua nasce desativada, e o
processamento registra ações pendentes de forma idempotente. Nenhuma mensagem é
enviada até a implantação do processador dos canais.

## Suspensão por inadimplência

Ao atingir o limite configurado, o sistema publica o evento append-only
`contract.suspended_for_delinquency`. O contrato não é alterado diretamente.
Esse isolamento permite que o módulo operacional aplique suas próprias regras,
registre a transição e reverta a suspensão após a baixa financeira.

## Segurança e auditoria

- leitura limitada ao tenant e à empresa concedida em `financial_access`;
- configuração e processamento exigem acesso financeiro de escrita;
- filas e eventos não permitem exclusão física;
- alterações entram no histórico financeiro existente;
- unicidade por título/etapa e por título/evento impede duplicidade em retries.

## Uso

Em **Financeiro**, abra **Régua de cobrança**, configure as etapas e salve. A
opção **Processar agora** somente fica disponível quando a régua está ativa.
Ela gera a fila e os eventos que podem ser inspecionados pelos indicadores do
modal, sem disparar comunicação externa nesta etapa.
