# Continuação da auditoria — 20/10/2026

Este documento complementa [a auditoria inicial](./auditoria-20261019.md). O responsável autorizou a publicação do lote `4151865`, a atualização principal do Nodemailer, a revogação das sessões anteriores após reset e a consulta dos destinos configurados em produção. Testes de credenciais continuam usando somente fixtures locais ou containers descartáveis.

## SEC-08 — Nodemailer

Atualizado de 9.1.1 para **10.1.7**, com versão exata nos dois aplicativos e no override do workspace. O `pnpm audit` passou com **zero avisos** em todas as severidades; isso é um retrato do catálogo consultado, não garantia de ausência de vulnerabilidades futuras.

Teste: `node scripts/security/test-mail-compatibility.mjs`. SMTP real limitado a loopback, sem carregar `.env` e sem destinatários reais. Verifica o envio do código do portal, resposta do tenant com threading, anexo PDF lido pelo mailparser e recusa SMTP. Usa os consumidores reais do web e da API compilada. Nenhuma mensagem externa foi enviada.

Antes: dois avisos altos e três moderados remanescentes no Nodemailer 9. Depois: nenhum aviso no audit. Rollback: revert do commit e instalação pelo lockfile; reabre os avisos corrigidos.

## Publicação anterior

O lote `4151865` foi enviado ao GitHub e as duas aplicações do Dokploy concluíram o deploy em 19/10/2026. O estado de deployment foi consultado no Dokploy. A verificação HTTP por dentro da rede será registrada separadamente; conclusão de build, sozinha, não atesta disponibilidade pública.
